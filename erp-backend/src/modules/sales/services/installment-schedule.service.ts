import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Installment,
  InstallmentFrequency,
  InstallmentPlan,
  InstallmentPlanStatus,
  InstallmentStatus,
} from '../entities/installment-plan.entity';
import { addDays, addMonths, round, today } from '@shared/utils/document-totals.util';

export interface ScheduleInput {
  startDate: string;
  firstDueDate: string;
  frequency: InstallmentFrequency;
  numberOfInstallments: number;
  downPayment: number;
  /** Amount spread over the installments (financed principal + interest). */
  installmentsTotal: number;
}

/**
 * Installment schedule generation and allocation of invoice payments to
 * installments (oldest due date first). Kept free of invoice logic so the
 * invoice service can call it whenever a payment is applied.
 */
@Injectable()
export class InstallmentScheduleService {
  constructor(
    @InjectRepository(InstallmentPlan)
    private readonly planRepo: Repository<InstallmentPlan>,
    @InjectRepository(Installment)
    private readonly installmentRepo: Repository<Installment>,
  ) {}

  /** Builds the schedule: optional down payment (sequence 0) then n equal installments. */
  static buildSchedule(input: ScheduleInput): Pick<Installment, 'sequence' | 'dueDate' | 'amount'>[] {
    const schedule: Pick<Installment, 'sequence' | 'dueDate' | 'amount'>[] = [];
    if (input.downPayment > 0) {
      schedule.push({ sequence: 0, dueDate: input.startDate, amount: round(input.downPayment, 4) });
    }
    const n = input.numberOfInstallments;
    const each = Math.floor((input.installmentsTotal / n) * 100) / 100;
    for (let i = 0; i < n; i++) {
      const dueDate =
        input.frequency === InstallmentFrequency.WEEKLY
          ? addDays(input.firstDueDate, 7 * i)
          : addMonths(input.firstDueDate, i);
      // The rounding remainder goes on the last installment.
      const amount = i === n - 1 ? round(input.installmentsTotal - each * (n - 1), 4) : each;
      schedule.push({ sequence: i + 1, dueDate, amount });
    }
    return schedule;
  }

  /**
   * Allocates `paid` to the installments by due date and sets each status
   * (paid / partial / overdue / due) as of `asOf`.
   */
  static allocate(installments: Installment[], paid: number, asOf: string = today()): Installment[] {
    let remaining = round(Math.max(paid, 0), 4);
    const sorted = [...installments].sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence,
    );
    for (const inst of sorted) {
      const amount = Number(inst.amount);
      const applied = round(Math.min(amount, remaining), 4);
      remaining = round(remaining - applied, 4);
      inst.paidAmount = applied;
      inst.status = InstallmentScheduleService.statusOf(amount, applied, inst.dueDate, asOf);
    }
    return sorted;
  }

  /**
   * Reschedules the unpaid balance. Installments keep what was paid on them:
   * a partially paid installment is reduced to its paid part and its unpaid
   * remainder joins the balance (Instasoft dropped that remainder). Fully
   * unpaid installments are replaced by new ones of `installmentAmount` (the
   * last takes the remainder) or by `numberOfInstallments` equal ones.
   */
  static reschedule(
    installments: Pick<Installment, 'id' | 'sequence' | 'dueDate' | 'amount' | 'paidAmount'>[],
    options: {
      installmentAmount?: number;
      numberOfInstallments?: number;
      firstDueDate?: string;
      frequency: InstallmentFrequency;
    },
  ) {
    const sorted = [...installments].sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.sequence - b.sequence,
    );
    const kept: { id: string; amount: number }[] = [];
    const removedIds: string[] = [];
    let remaining = 0;
    let lastKeptDue: string | null = null;
    let firstOpenDue: string | null = null;
    let maxSequence = 0;
    for (const inst of sorted) {
      const amount = Number(inst.amount);
      const paid = round(Math.min(Number(inst.paidAmount), amount), 4);
      const open = round(amount - paid, 4);
      if (open > 0 && !firstOpenDue) firstOpenDue = inst.dueDate;
      remaining = round(remaining + open, 4);
      if (paid > 0) {
        if (open > 0) kept.push({ id: inst.id, amount: paid });
        if (lastKeptDue === null || inst.dueDate > (lastKeptDue as string)) lastKeptDue = inst.dueDate;
        maxSequence = Math.max(maxSequence, inst.sequence);
      } else {
        removedIds.push(inst.id);
      }
    }
    if (remaining <= 0) throw new ConflictException('Nothing left to reschedule');

    const hasAmount = options.installmentAmount !== undefined && options.installmentAmount !== null;
    const hasCount = options.numberOfInstallments !== undefined && options.numberOfInstallments !== null;
    if (hasAmount === hasCount) {
      throw new BadRequestException('Give either installmentAmount or numberOfInstallments');
    }
    const firstDueDate = options.firstDueDate || firstOpenDue!;
    if (lastKeptDue !== null && firstDueDate < (lastKeptDue as string)) {
      throw new BadRequestException(
        `The first new due date cannot be before ${lastKeptDue} (last installment with payments)`,
      );
    }

    const dueAt = (i: number) =>
      options.frequency === InstallmentFrequency.WEEKLY
        ? addDays(firstDueDate, 7 * i)
        : addMonths(firstDueDate, i);
    const created: Pick<Installment, 'sequence' | 'dueDate' | 'amount'>[] = [];
    if (hasAmount) {
      const each = round(Number(options.installmentAmount), 2);
      const count = Math.ceil(round(remaining / each, 6));
      if (count > 360) throw new BadRequestException('The installment amount is too small');
      for (let i = 0; i < count; i++) {
        const amount = i === count - 1 ? round(remaining - each * (count - 1), 4) : each;
        created.push({ sequence: maxSequence + i + 1, dueDate: dueAt(i), amount });
      }
    } else {
      const schedule = InstallmentScheduleService.buildSchedule({
        startDate: firstDueDate,
        firstDueDate,
        frequency: options.frequency,
        numberOfInstallments: Number(options.numberOfInstallments),
        downPayment: 0,
        installmentsTotal: remaining,
      });
      schedule.forEach((s) => created.push({ ...s, sequence: maxSequence + s.sequence }));
    }
    return { kept, removedIds, created, remaining };
  }

  static statusOf(amount: number, paid: number, dueDate: string, asOf: string): InstallmentStatus {
    if (paid >= amount - 0.0001) return InstallmentStatus.PAID;
    if (dueDate < asOf) return InstallmentStatus.OVERDUE;
    return paid > 0 ? InstallmentStatus.PARTIAL : InstallmentStatus.DUE;
  }

  /**
   * Recomputes the installments of every non-cancelled plan of an invoice
   * from the invoice paid amount (payments, credit notes and returns all
   * count as settlement).
   */
  async syncInvoice(tenantId: string, invoiceId: string, invoicePaidAmount: number): Promise<InstallmentPlan[]> {
    const plans = await this.planRepo.find({
      where: {
        tenantId,
        invoiceId,
        status: In([InstallmentPlanStatus.ACTIVE, InstallmentPlanStatus.COMPLETED]),
      },
      relations: ['installments'],
    });
    for (const plan of plans) {
      await this.applyToPlan(plan, invoicePaidAmount);
    }
    return plans;
  }

  async applyToPlan(plan: InstallmentPlan, invoicePaidAmount: number): Promise<InstallmentPlan> {
    const allocatable = Math.max(round(invoicePaidAmount - Number(plan.paidBeforePlan), 4), 0);
    const installments = InstallmentScheduleService.allocate(plan.installments ?? [], allocatable);
    plan.paidAmount = round(Math.min(allocatable, Number(plan.totalAmount)), 4);
    plan.status = installments.every((i) => i.status === InstallmentStatus.PAID)
      ? InstallmentPlanStatus.COMPLETED
      : InstallmentPlanStatus.ACTIVE;
    if (installments.length) await this.installmentRepo.save(installments);
    plan.installments = installments;
    const { installments: _i, ...header } = plan;
    await this.planRepo.save(header as InstallmentPlan);
    return plan;
  }
}
