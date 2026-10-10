import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Installment,
  InstallmentFrequency,
  InstallmentPlan,
  InstallmentPlanStatus,
  InstallmentStatus,
} from '../entities/installment-plan.entity';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '../entities/sales-invoice.entity';
import {
  CreateInstallmentPlanDto,
  InstallmentGuarantorDto,
  InstallmentReportQueryDto,
  RescheduleInstallmentPlanDto,
} from '../dto/installment-plan.dto';
import { SalesInvoicesService } from './sales-invoices.service';
import { InstallmentScheduleService } from './installment-schedule.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import {
  addDays,
  addMonths,
  paymentState,
  residual,
  round,
  today,
} from '@shared/utils/document-totals.util';

const OPEN_INVOICE = [
  SalesInvoiceStatus.POSTED,
  SalesInvoiceStatus.SENT,
  SalesInvoiceStatus.PARTIAL,
  SalesInvoiceStatus.OVERDUE,
];

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/**
 * Installment sales. A plan spreads the residual of a posted invoice over a
 * down payment and n monthly/weekly installments.
 *
 * Financing income uses the simple (flat) method: interest = financed amount
 * x rate, recognised in full when the plan is created (Dr receivable /
 * Cr installment interest) and added to the invoice total so that the
 * customer's payments on the invoice settle it. Payments applied to the
 * invoice are allocated to installments by due date.
 */
@Injectable()
export class InstallmentPlansService {
  constructor(
    @InjectRepository(InstallmentPlan)
    private readonly planRepo: Repository<InstallmentPlan>,
    @InjectRepository(Installment)
    private readonly installmentRepo: Repository<Installment>,
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepo: Repository<SalesInvoice>,
    private readonly invoicesService: SalesInvoicesService,
    private readonly schedule: InstallmentScheduleService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateInstallmentPlanDto): Promise<InstallmentPlan> {
    const invoice = await this.invoicesService.findById(tenantId, dto.invoiceId);
    if (invoice.moveType === SalesInvoiceType.CREDIT_NOTE) {
      throw new BadRequestException('Credit notes cannot be sold on installments');
    }
    if (!OPEN_INVOICE.includes(invoice.status)) {
      throw new ConflictException('Installment plans require a posted invoice with an open balance');
    }
    const existing = await this.planRepo.findOne({
      where: {
        tenantId,
        invoiceId: invoice.id,
        status: In([InstallmentPlanStatus.ACTIVE, InstallmentPlanStatus.COMPLETED]),
      },
    });
    if (existing) {
      throw new ConflictException(`Invoice already has installment plan ${existing.planNumber}`);
    }

    const principal = residual(invoice.totalAmount, invoice.paidAmount);
    const downPayment = round(Number(dto.downPayment ?? 0), 4);
    if (downPayment >= principal) {
      throw new BadRequestException('The down payment must be lower than the invoice residual');
    }
    const financed = round(principal - downPayment, 4);
    const interestRate = Number(dto.interestRate ?? 0);
    const interest = round(financed * (interestRate / 100), 4);
    const frequency = dto.frequency ?? InstallmentFrequency.MONTHLY;
    const startDate = dto.startDate || today();
    const firstDueDate =
      dto.firstDueDate ||
      (frequency === InstallmentFrequency.WEEKLY ? addDays(startDate, 7) : addMonths(startDate, 1));
    if (firstDueDate < startDate) {
      throw new BadRequestException('The first due date cannot be before the start date');
    }

    if (interest > 0) {
      await this.autoPosting.preflight(tenantId, startDate, [
        'receivableAccountId',
        'installmentInterestAccountId',
      ]);
    }

    const plan = await this.planRepo.save(
      this.planRepo.create({
        tenantId,
        planNumber: await this.sequenceService.next(tenantId, 'installment_plan', 'INST'),
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        startDate,
        firstDueDate,
        frequency,
        numberOfInstallments: dto.numberOfInstallments,
        principalAmount: principal,
        downPayment,
        interestRate,
        interestAmount: interest,
        totalAmount: round(principal + interest, 4),
        paidBeforePlan: Number(invoice.paidAmount),
        paidAmount: 0,
        status: InstallmentPlanStatus.ACTIVE,
        notes: dto.notes,
        ...InstallmentPlansService.guarantorFields(dto.guarantor),
        createdBy: userId,
        installments: InstallmentScheduleService.buildSchedule({
          startDate,
          firstDueDate,
          frequency,
          numberOfInstallments: dto.numberOfInstallments,
          downPayment,
          installmentsTotal: round(financed + interest, 4),
        }).map((i) => this.installmentRepo.create(i)),
      }),
    );

    if (interest > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.SALE,
        date: startDate,
        description: `Installment financing ${plan.planNumber} on ${invoice.invoiceNumber}`,
        sourceType: 'installment_plan',
        sourceId: plan.id,
        currencyId: invoice.currencyId,
        exchangeRate: Number(invoice.exchangeRate || 1),
        buildLines: (_s, account) => [
          { accountId: account('receivableAccountId'), debit: interest },
          { accountId: account('installmentInterestAccountId'), credit: interest },
        ],
      });
      await this.changeInvoiceInterest(invoice, interest);
      await this.invoicesService.adjustCustomerBalance(tenantId, invoice.customerId, interest);
    }

    await this.schedule.applyToPlan(plan, Number(invoice.paidAmount));
    return this.findById(tenantId, plan.id);
  }

  async findAll(
    tenantId: string,
    filters: { customerId?: string; invoiceId?: string; status?: InstallmentPlanStatus } = {},
  ): Promise<InstallmentPlan[]> {
    const where: Record<string, unknown> = { tenantId };
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.invoiceId) where.invoiceId = filters.invoiceId;
    if (filters.status) where.status = filters.status;
    const plans = await this.planRepo.find({
      where,
      relations: ['installments', 'customer'],
      order: { createdAt: 'DESC' },
    });
    plans.forEach((p) => this.sortAndRefresh(p));
    return plans;
  }

  async findById(tenantId: string, id: string): Promise<InstallmentPlan> {
    const plan = await this.planRepo.findOne({
      where: { id, tenantId },
      relations: ['installments', 'customer', 'invoice'],
    });
    if (!plan) throw new NotFoundException('Installment plan not found');
    return this.sortAndRefresh(plan);
  }

  /** Re-allocates the invoice paid amount to the plan installments. */
  async recompute(tenantId: string, id: string): Promise<InstallmentPlan> {
    const plan = await this.findById(tenantId, id);
    if (plan.status === InstallmentPlanStatus.CANCELLED) {
      throw new ConflictException('The plan is cancelled');
    }
    const invoice = await this.invoicesService.findById(tenantId, plan.invoiceId);
    await this.schedule.applyToPlan(plan, Number(invoice.paidAmount));
    return this.findById(tenantId, id);
  }

  async recomputeInvoice(tenantId: string, invoiceId: string): Promise<InstallmentPlan[]> {
    const invoice = await this.invoicesService.findById(tenantId, invoiceId);
    return this.schedule.syncInvoice(tenantId, invoice.id, Number(invoice.paidAmount));
  }

  /** Cancels a plan without collected installments and reverses its financing income. */
  async cancel(tenantId: string, userId: string, id: string): Promise<InstallmentPlan> {
    const plan = await this.findById(tenantId, id);
    if (plan.status === InstallmentPlanStatus.CANCELLED) {
      throw new ConflictException('The plan is already cancelled');
    }
    if (Number(plan.paidAmount) > 0) {
      throw new ConflictException('Plans with collected installments cannot be cancelled');
    }
    const interest = Number(plan.interestAmount);
    if (interest > 0) {
      const invoice = await this.invoicesService.findById(tenantId, plan.invoiceId);
      if (residual(invoice.totalAmount, invoice.paidAmount) + 0.0001 < interest) {
        throw new ConflictException('The invoice residual no longer covers the financing interest');
      }
      await this.autoPosting.reverseSource(tenantId, userId, 'installment_plan', plan.id);
      await this.changeInvoiceInterest(invoice, -interest);
      await this.invoicesService.adjustCustomerBalance(tenantId, invoice.customerId, -interest);
    }
    plan.status = InstallmentPlanStatus.CANCELLED;
    const { installments: _i, customer: _c, invoice: _v, ...header } = plan;
    await this.planRepo.save(header as InstallmentPlan);
    return this.findById(tenantId, id);
  }

  /** Sets or replaces the guarantor of a plan. */
  async setGuarantor(
    tenantId: string,
    id: string,
    dto: InstallmentGuarantorDto,
  ): Promise<InstallmentPlan> {
    const plan = await this.findById(tenantId, id);
    await this.planRepo.update(
      { id: plan.id, tenantId },
      InstallmentPlansService.guarantorFields(dto),
    );
    return this.findById(tenantId, id);
  }

  static guarantorFields(dto?: InstallmentGuarantorDto) {
    return {
      guarantorName: dto?.name ?? null,
      guarantorPhone: dto?.phone ?? null,
      guarantorNationalId: dto?.nationalId ?? null,
      guarantorCustomerId: dto?.customerId ?? null,
    };
  }

  /**
   * Reschedules the unpaid balance of an active plan: installments keep what
   * was paid on them (a partially paid one is reduced to its paid part) and
   * the whole unpaid balance, partial remainders included, is spread over new
   * installments. The plan total is unchanged (no extra interest).
   */
  async reschedule(
    tenantId: string,
    id: string,
    dto: RescheduleInstallmentPlanDto,
  ): Promise<InstallmentPlan> {
    let plan = await this.findById(tenantId, id);
    if (plan.status !== InstallmentPlanStatus.ACTIVE) {
      throw new ConflictException('Only active plans can be rescheduled');
    }
    // Start from an up-to-date allocation of the invoice payments.
    const invoice = await this.invoicesService.findById(tenantId, plan.invoiceId);
    await this.schedule.applyToPlan(plan, Number(invoice.paidAmount));
    plan = await this.findById(tenantId, id);

    const frequency = dto.frequency ?? plan.frequency;
    const result = InstallmentScheduleService.reschedule(plan.installments, {
      installmentAmount: dto.installmentAmount,
      numberOfInstallments: dto.numberOfInstallments,
      firstDueDate: dto.firstDueDate,
      frequency,
    });

    for (const k of result.kept) {
      await this.installmentRepo.update({ id: k.id }, { amount: k.amount });
    }
    if (result.removedIds.length) await this.installmentRepo.delete(result.removedIds);
    await this.installmentRepo.save(
      result.created.map((c) => this.installmentRepo.create({ ...c, planId: plan.id, paidAmount: 0 })),
    );
    const remainingSequences = plan.installments
      .filter((i) => !result.removedIds.includes(i.id) && i.sequence > 0).length;
    await this.planRepo.update(
      { id: plan.id, tenantId },
      {
        frequency,
        numberOfInstallments: remainingSequences + result.created.length,
        rescheduleCount: Number(plan.rescheduleCount ?? 0) + 1,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
    );

    const fresh = await this.findById(tenantId, id);
    await this.schedule.applyToPlan(fresh, Number(invoice.paidAmount));
    return this.findById(tenantId, id);
  }

  /** Due / overdue installments of active plans (collection list). */
  async dueReport(tenantId: string, query: InstallmentReportQueryDto) {
    const asOf = query.asOf || today();
    const where: Record<string, unknown> = { tenantId, status: InstallmentPlanStatus.ACTIVE };
    if (query.customerId) where.customerId = query.customerId;
    const plans = await this.planRepo.find({
      where,
      relations: ['installments', 'customer', 'invoice'],
    });
    const rows = plans
      .flatMap((plan) =>
        (plan.installments ?? []).map((inst) => {
          const amount = Number(inst.amount);
          const paid = Number(inst.paidAmount);
          const status = InstallmentScheduleService.statusOf(amount, paid, inst.dueDate, asOf);
          const daysLate = status === InstallmentStatus.OVERDUE ? daysBetween(inst.dueDate, asOf) : 0;
          return {
            planId: plan.id,
            planNumber: plan.planNumber,
            invoiceId: plan.invoiceId,
            invoiceNumber: plan.invoice?.invoiceNumber,
            customerId: plan.customerId,
            customerName: plan.customer?.nameAr || plan.customer?.nameEn,
            installmentId: inst.id,
            sequence: inst.sequence,
            dueDate: inst.dueDate,
            amount,
            paidAmount: paid,
            remaining: round(amount - paid, 4),
            status,
            daysOverdue: daysLate,
            daysLate,
            daysUntilDue: Math.max(daysBetween(asOf, inst.dueDate), 0),
            bucket:
              status === InstallmentStatus.OVERDUE
                ? 'overdue'
                : inst.dueDate === asOf
                  ? 'due_today'
                  : 'upcoming',
            guarantorName: plan.guarantorName,
            guarantorPhone: plan.guarantorPhone,
          };
        }),
      )
      .filter((r) => r.status !== InstallmentStatus.PAID)
      .filter((r) => !query.dueTo || r.dueDate <= query.dueTo)
      .filter(
        (r) =>
          query.upcomingDays === undefined ||
          query.upcomingDays === null ||
          r.dueDate <= addDays(asOf, Number(query.upcomingDays)),
      )
      .filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return {
      asOf,
      rows,
      totalRemaining: round(rows.reduce((s, r) => s + r.remaining, 0), 4),
      totalOverdue: round(
        rows.filter((r) => r.status === InstallmentStatus.OVERDUE).reduce((s, r) => s + r.remaining, 0),
        4,
      ),
    };
  }

  /** Installment statement of a customer: every plan with its schedule and totals. */
  async customerStatement(tenantId: string, customerId: string, asOf = today()) {
    const plans = await this.planRepo.find({
      where: { tenantId, customerId, status: In([InstallmentPlanStatus.ACTIVE, InstallmentPlanStatus.COMPLETED]) },
      relations: ['installments', 'invoice'],
      order: { startDate: 'ASC' },
    });
    let total = 0;
    let paid = 0;
    let overdue = 0;
    const statement = plans.map((plan) => {
      const installments = [...(plan.installments ?? [])]
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence)
        .map((inst) => {
          const amount = Number(inst.amount);
          const instPaid = Number(inst.paidAmount);
          const status = InstallmentScheduleService.statusOf(amount, instPaid, inst.dueDate, asOf);
          total += amount;
          paid += instPaid;
          if (status === InstallmentStatus.OVERDUE) overdue += amount - instPaid;
          return {
            sequence: inst.sequence,
            dueDate: inst.dueDate,
            amount,
            paidAmount: instPaid,
            remaining: round(amount - instPaid, 4),
            status,
          };
        });
      return {
        planId: plan.id,
        planNumber: plan.planNumber,
        invoiceNumber: plan.invoice?.invoiceNumber,
        status: plan.status,
        principalAmount: Number(plan.principalAmount),
        interestAmount: Number(plan.interestAmount),
        totalAmount: Number(plan.totalAmount),
        paidAmount: Number(plan.paidAmount),
        installments,
      };
    });
    return {
      customerId,
      asOf,
      plans: statement,
      totalAmount: round(total, 4),
      paidAmount: round(paid, 4),
      remaining: round(total - paid, 4),
      overdueAmount: round(overdue, 4),
    };
  }

  private async changeInvoiceInterest(invoice: SalesInvoice, delta: number): Promise<void> {
    invoice.totalAmount = round(Number(invoice.totalAmount) + delta, 4);
    invoice.installmentInterest = round(Number(invoice.installmentInterest || 0) + delta, 4);
    const state = paymentState(invoice.paidAmount, invoice.totalAmount);
    invoice.status =
      state === 'paid'
        ? SalesInvoiceStatus.PAID
        : state === 'partial'
          ? SalesInvoiceStatus.PARTIAL
          : SalesInvoiceStatus.POSTED;
    const { lines: _l, customer: _c, ...header } = invoice;
    await this.invoiceRepo.save(header as SalesInvoice);
  }

  /** Sorts installments and refreshes overdue statuses for display. */
  private sortAndRefresh(plan: InstallmentPlan): InstallmentPlan {
    const asOf = today();
    plan.installments = [...(plan.installments ?? [])]
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence)
      .map((inst) => {
        inst.status = InstallmentScheduleService.statusOf(
          Number(inst.amount),
          Number(inst.paidAmount),
          inst.dueDate,
          asOf,
        );
        return inst;
      });
    return plan;
  }
}
