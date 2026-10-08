import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  EmployeeLoan,
  HrPaymentMethod,
  LoanStatus,
} from '../entities/employee-loan.entity';
import { LoanInstallment } from '../entities/loan-installment.entity';
import { EmployeeStatus } from '../entities/employee.entity';
import { CreateLoanDto, DisburseLoanDto, LoanQueryDto } from '../dto/loan.dto';
import { EmployeesService } from './employees.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round } from '@shared/utils/document-totals.util';

/** YYYY-MM + n months. */
export function addMonths(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Splits an amount into `count` installments; the last one absorbs rounding. */
export function splitInstallments(amount: number, count: number): number[] {
  const base = Math.floor((amount / count) * 100) / 100;
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = round(amount - base * (count - 1), 2);
  return parts;
}

export interface InstallmentRecovery {
  id: string;
  loanId: string;
  amount: number;
}

/** Employee loans and salary advances (سلف) recovered through payroll. */
@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(EmployeeLoan)
    private readonly loanRepo: Repository<EmployeeLoan>,
    @InjectRepository(LoanInstallment)
    private readonly installmentRepo: Repository<LoanInstallment>,
    private readonly employees: EmployeesService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, query: LoanQueryDto = {}) {
    const where: any = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    return this.loanRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string): Promise<EmployeeLoan> {
    const loan = await this.loanRepo.findOne({
      where: { id, tenantId },
      relations: ['installments'],
      order: { installments: { sequence: 'ASC' } } as any,
    });
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  async create(tenantId: string, userId: string, dto: CreateLoanDto): Promise<EmployeeLoan> {
    const employee = await this.employees.findById(tenantId, dto.employeeId);
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw new BadRequestException('Loans can only be granted to active employees');
    }
    const loanNumber = await this.sequenceService.next(tenantId, 'employee_loan', 'LOAN');
    const loan = await this.loanRepo.save(
      this.loanRepo.create({
        tenantId,
        loanNumber,
        employeeId: dto.employeeId,
        type: dto.type,
        amount: round(dto.amount, 2),
        installmentCount: dto.installmentCount,
        startPeriod: dto.startPeriod,
        repaidAmount: 0,
        status: LoanStatus.DRAFT,
        notes: dto.notes,
        createdBy: userId,
      }),
    );
    return this.findById(tenantId, loan.id);
  }

  /**
   * Pays the loan to the employee: Dr employee advances / Cr cash or bank,
   * and generates the monthly installment schedule.
   */
  async disburse(tenantId: string, userId: string, id: string, dto: DisburseLoanDto) {
    const loan = await this.findById(tenantId, id);
    if (loan.status !== LoanStatus.DRAFT) throw new ConflictException('Only draft loans can be disbursed');
    const liquidityKey = dto.paymentMethod === HrPaymentMethod.CASH ? 'cashAccountId' : 'bankAccountId';
    await this.autoPosting.preflight(tenantId, dto.date, ['employeeAdvancesAccountId', liquidityKey]);

    const amounts = splitInstallments(Number(loan.amount), loan.installmentCount);
    await this.installmentRepo.save(
      amounts.map((amount, i) =>
        this.installmentRepo.create({
          loanId: loan.id,
          sequence: i + 1,
          duePeriod: addMonths(loan.startPeriod, i),
          amount,
          paidAmount: 0,
        }),
      ),
    );
    loan.status = LoanStatus.DISBURSED;
    loan.disbursementDate = dto.date;
    loan.paymentMethod = dto.paymentMethod;
    await this.loanRepo.update(loan.id, {
      status: loan.status,
      disbursementDate: loan.disbursementDate,
      paymentMethod: loan.paymentMethod,
    });

    const amount = Number(loan.amount);
    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: dto.paymentMethod === HrPaymentMethod.CASH ? JournalType.CASH : JournalType.BANK,
      date: dto.date,
      description: `Employee ${loan.type} ${loan.loanNumber}`,
      sourceType: 'employee_loan',
      sourceId: loan.id,
      buildLines: (_s, account) => [
        { accountId: account('employeeAdvancesAccountId'), debit: amount },
        { accountId: account(liquidityKey), credit: amount },
      ],
    });
    return this.findById(tenantId, id);
  }

  /** Cancels a draft loan, or a disbursed one nothing has been recovered on yet. */
  async cancel(tenantId: string, userId: string, id: string) {
    const loan = await this.findById(tenantId, id);
    if (loan.status === LoanStatus.DRAFT) {
      await this.loanRepo.update(loan.id, { status: LoanStatus.CANCELLED });
      return this.findById(tenantId, id);
    }
    if (loan.status !== LoanStatus.DISBURSED) {
      throw new ConflictException(`A ${loan.status} loan cannot be cancelled`);
    }
    if (Number(loan.repaidAmount) > 0) {
      throw new ConflictException('Installments were already recovered through payroll');
    }
    await this.autoPosting.reverseSource(tenantId, userId, 'employee_loan', loan.id);
    await this.installmentRepo.delete({ loanId: loan.id });
    await this.loanRepo.update(loan.id, { status: LoanStatus.CANCELLED });
    return this.findById(tenantId, id);
  }

  /** Outstanding installments due up to `period` for an employee, oldest first. */
  async dueInstallments(tenantId: string, employeeId: string, period: string) {
    const loans = await this.loanRepo.find({
      where: { tenantId, employeeId, status: LoanStatus.DISBURSED },
    });
    if (!loans.length) return [];
    const installments = await this.installmentRepo.find({
      where: { loanId: In(loans.map((l) => l.id)) },
      order: { duePeriod: 'ASC', sequence: 'ASC' },
    });
    return installments
      .filter((i) => i.duePeriod <= period && Number(i.paidAmount) < Number(i.amount))
      .map((i) => ({
        id: i.id,
        loanId: i.loanId,
        amount: round(Number(i.amount) - Number(i.paidAmount), 2),
      }));
  }

  /**
   * Allocates `amount` to all the employee's outstanding installments
   * (whatever their due month), oldest first: used by the final settlement.
   */
  async allocateOutstanding(tenantId: string, employeeId: string, amount: number): Promise<InstallmentRecovery[]> {
    const outstanding = await this.dueInstallments(tenantId, employeeId, '9999-12');
    const out: InstallmentRecovery[] = [];
    let left = round(amount, 2);
    for (const installment of outstanding) {
      if (left <= 0) break;
      const take = round(Math.min(installment.amount, left), 2);
      out.push({ ...installment, amount: take });
      left = round(left - take, 2);
    }
    return out;
  }

  /** Outstanding loan balance of an employee. */
  async outstandingBalance(tenantId: string, employeeId: string): Promise<number> {
    const outstanding = await this.dueInstallments(tenantId, employeeId, '9999-12');
    return round(outstanding.reduce((s, i) => s + i.amount, 0), 2);
  }

  /**
   * Records (sign = 1) or undoes (sign = -1) installment recoveries made by
   * an approved payroll, updating the loans' repaid amount and status.
   */
  async applyRecoveries(tenantId: string, recoveries: InstallmentRecovery[], sign: 1 | -1) {
    if (!recoveries.length) return;
    const installments = await this.installmentRepo.find({
      where: { id: In(recoveries.map((r) => r.id)) },
    });
    const byId = new Map(installments.map((i) => [i.id, i]));
    const perLoan = new Map<string, number>();
    for (const recovery of recoveries) {
      const installment = byId.get(recovery.id);
      if (!installment) throw new NotFoundException(`Loan installment ${recovery.id} not found`);
      const paid = round(Number(installment.paidAmount) + sign * recovery.amount, 4);
      if (paid < -0.0001 || paid > Number(installment.amount) + 0.0001) {
        throw new ConflictException(
          `Loan installment ${installment.sequence} recovery is inconsistent; recompute the payroll`,
        );
      }
      installment.paidAmount = paid;
      await this.installmentRepo.update(installment.id, { paidAmount: paid });
      perLoan.set(recovery.loanId, round((perLoan.get(recovery.loanId) ?? 0) + recovery.amount, 4));
    }
    for (const [loanId, amount] of perLoan) {
      const loan = await this.loanRepo.findOne({ where: { id: loanId, tenantId } });
      if (!loan) throw new NotFoundException(`Loan ${loanId} not found`);
      const repaid = round(Number(loan.repaidAmount) + sign * amount, 4);
      const status = repaid >= Number(loan.amount) - 0.0001 ? LoanStatus.SETTLED : LoanStatus.DISBURSED;
      await this.loanRepo.update(loan.id, { repaidAmount: repaid, status });
    }
  }
}
