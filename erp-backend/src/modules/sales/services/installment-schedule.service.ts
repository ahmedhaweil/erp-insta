import { Injectable } from '@nestjs/common';
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
