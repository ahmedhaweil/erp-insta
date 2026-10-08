import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EosProvision, EosProvisionLine, EosProvisionStatus } from '../entities/eos-provision.entity';
import { FinalSettlement, FinalSettlementStatus } from '../entities/final-settlement.entity';
import { Employee, EmployeeStatus } from '../entities/employee.entity';
import { LeaveType } from '../entities/leave-type.entity';
import { HrPaymentMethod } from '../entities/employee-loan.entity';
import {
  CancelFinalSettlementDto,
  CreateEosProvisionDto,
  CreateFinalSettlementDto,
  FinalSettlementQueryDto,
  PayFinalSettlementDto,
  PostFinalSettlementDto,
} from '../dto/eos.dto';
import { EmployeesService } from './employees.service';
import { LeavesService } from './leaves.service';
import { LoansService, InstallmentRecovery } from './loans.service';
import { HrAccounts, HrSettingsService } from './hr-settings.service';
import { PayrollLockService } from './payroll-lock.service';
import { periodBounds } from './payroll.service';
import { PayrollCalculator } from '../calculators/payroll-calculator';
import { AutoPostingService, PostingLine } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round } from '@shared/utils/document-totals.util';

export const EOS_PROVISION_SOURCE = 'eos_provision';
export const SETTLEMENT_SOURCE = 'final_settlement';
export const SETTLEMENT_PAYMENT_SOURCE = 'final_settlement_payment';

const ACTIVE_SETTLEMENT = [FinalSettlementStatus.DRAFT, FinalSettlementStatus.POSTED, FinalSettlementStatus.PAID];
const BOOKED_SETTLEMENT = [FinalSettlementStatus.POSTED, FinalSettlementStatus.PAID];

const DAY = 86400000;
const daysInclusive = (from: string, to: string) =>
  to < from ? 0 : Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;

export interface ProvisionDelta {
  employeeId: string;
  delta: number;
  branchId?: string | null;
  costCenterId?: string | null;
}

/**
 * End of service: the monthly gratuity provision and the final settlement
 * of terminated employees.
 */
@Injectable()
export class EndOfServiceService {
  constructor(
    @InjectRepository(EosProvision)
    private readonly provisionRepo: Repository<EosProvision>,
    @InjectRepository(EosProvisionLine)
    private readonly provisionLineRepo: Repository<EosProvisionLine>,
    @InjectRepository(FinalSettlement)
    private readonly settlementRepo: Repository<FinalSettlement>,
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    @InjectRepository(LeaveType)
    private readonly leaveTypeRepo: Repository<LeaveType>,
    private readonly employees: EmployeesService,
    private readonly leaves: LeavesService,
    private readonly loans: LoansService,
    private readonly settings: HrSettingsService,
    private readonly payrollLock: PayrollLockService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  // ------------------------------------------------------------ pure rules

  /** Gratuity liability of an employee at a date (termination basis, no resignation reduction). */
  static liability(calculator: PayrollCalculator, employee: Employee, wage: number, date: string) {
    return calculator.gratuity({
      country: employee.payrollCountry,
      monthlyWage: wage,
      startDate: String(employee.hireDate),
      endDate: date,
      reason: 'termination',
    });
  }

  /**
   * Provision entry: Dr EOS expense / Cr EOS provision for increases,
   * the opposite for releases (liability below the booked provision).
   */
  static provisionLines(deltas: ProvisionDelta[], accounts: HrAccounts): PostingLine[] {
    const out: PostingLine[] = [];
    for (const d of deltas) {
      const amount = round(Math.abs(d.delta), 4);
      if (!amount) continue;
      const branchId = d.branchId ?? undefined;
      const costCenterId = d.costCenterId ?? undefined;
      const expense = { accountId: accounts.eosExpenseAccountId as string, branchId, costCenterId };
      const provision = { accountId: accounts.eosProvisionAccountId as string, branchId };
      if (d.delta > 0) out.push({ ...expense, debit: amount }, { ...provision, credit: amount });
      else out.push({ ...provision, debit: amount }, { ...expense, credit: amount });
    }
    return out;
  }

  /**
   * Settlement entry:
   *   Dr EOS provision (provision used)      Cr employee advances (loan balance)
   *   Dr/Cr EOS expense (gratuity - used)    Cr salaries expense (other deductions)
   *   Dr salaries expense (leave + last      Cr salaries payable (net)
   *      salary + other additions)
   * Without EOS accounts the gratuity is expensed to salaries expense.
   */
  static settlementLines(
    s: Pick<
      FinalSettlement,
      | 'gratuity'
      | 'provisionUsed'
      | 'leaveEncashment'
      | 'lastSalary'
      | 'otherAdditions'
      | 'loanDeduction'
      | 'otherDeductions'
      | 'net'
    >,
    accounts: HrAccounts,
    account: (key: any) => string,
    dims: { branchId?: string; costCenterId?: string } = {},
  ): PostingLine[] {
    const { branchId, costCenterId } = dims;
    const salaries = account('salariesExpenseAccountId');
    const gratuity = Number(s.gratuity);
    const used = Number(s.provisionUsed);
    const out: PostingLine[] = [];
    if (accounts.eosExpenseAccountId && accounts.eosProvisionAccountId) {
      out.push({ accountId: accounts.eosProvisionAccountId, debit: used, branchId });
      const diff = round(gratuity - used, 4);
      if (diff > 0) out.push({ accountId: accounts.eosExpenseAccountId, debit: diff, branchId, costCenterId });
      if (diff < 0) out.push({ accountId: accounts.eosExpenseAccountId, credit: -diff, branchId, costCenterId });
    } else {
      out.push({ accountId: salaries, debit: gratuity, branchId, costCenterId });
    }
    out.push(
      {
        accountId: salaries,
        debit: round(Number(s.leaveEncashment) + Number(s.lastSalary) + Number(s.otherAdditions), 4),
        branchId,
        costCenterId,
      },
      { accountId: account('employeeAdvancesAccountId'), credit: Number(s.loanDeduction), branchId },
      { accountId: salaries, credit: Number(s.otherDeductions), branchId, costCenterId },
      { accountId: account('salariesPayableAccountId'), credit: Number(s.net), branchId },
    );
    return out;
  }

  // ------------------------------------------------------------ provision

  findProvisions(tenantId: string) {
    return this.provisionRepo.find({ where: { tenantId }, order: { period: 'DESC', createdAt: 'DESC' } });
  }

  async findProvision(tenantId: string, id: string) {
    const provision = await this.provisionRepo.findOne({ where: { id, tenantId } });
    if (!provision) throw new NotFoundException('EOS provision not found');
    provision.lines = await this.provisionLineRepo.find({
      where: { provisionId: id },
      order: { employeeCode: 'ASC' },
    });
    return provision;
  }

  /** Provision booked per employee: posted provision deltas less what settlements used. */
  async bookedProvisions(tenantId: string, employeeIds?: string[]): Promise<Map<string, number>> {
    const provisions = await this.provisionRepo.find({
      where: { tenantId, status: EosProvisionStatus.POSTED },
    });
    const booked = new Map<string, number>();
    if (provisions.length) {
      const where: any = { provisionId: In(provisions.map((p) => p.id)) };
      if (employeeIds) where.employeeId = In(employeeIds);
      for (const line of await this.provisionLineRepo.find({ where })) {
        booked.set(line.employeeId, round((booked.get(line.employeeId) ?? 0) + Number(line.delta), 4));
      }
    }
    const swhere: any = { tenantId, status: In(BOOKED_SETTLEMENT) };
    if (employeeIds) swhere.employeeId = In(employeeIds);
    for (const s of await this.settlementRepo.find({ where: swhere })) {
      booked.set(s.employeeId, round((booked.get(s.employeeId) ?? 0) - Number(s.provisionUsed), 4));
    }
    return booked;
  }

  /**
   * Posts the provision of a month: for every employee employed at the
   * period end (or terminated in/after the month and not yet settled), the
   * liability at that date less the provision booked so far.
   */
  async createProvision(tenantId: string, userId: string, dto: CreateEosProvisionDto) {
    const bounds = periodBounds(dto.period);
    const postingDate = dto.postingDate ?? bounds.end;
    const existing = await this.provisionRepo.findOne({
      where: { tenantId, period: dto.period, status: EosProvisionStatus.POSTED },
    });
    if (existing) throw new ConflictException(`The EOS provision of ${dto.period} is already posted`);
    const later = await this.provisionRepo.find({ where: { tenantId, status: EosProvisionStatus.POSTED } });
    if (later.some((p) => p.period > dto.period)) {
      throw new ConflictException('A later month is already provisioned; reverse it first');
    }
    const accounts = await this.settings.getAccounts(tenantId);
    if (!accounts.eosExpenseAccountId || !accounts.eosProvisionAccountId) {
      throw new BadRequestException(
        'Set eosExpenseAccountId and eosProvisionAccountId in PUT /hr/settings first',
      );
    }
    await this.autoPosting.preflight(tenantId, postingDate, []);

    const settled = new Set(
      (await this.settlementRepo.find({ where: { tenantId, status: In(BOOKED_SETTLEMENT) } })).map(
        (s) => s.employeeId,
      ),
    );
    const employees = (
      await this.employeeRepo
        .createQueryBuilder('e')
        .where('e.tenant_id = :tenantId', { tenantId })
        .andWhere('e.hire_date <= :end', { end: bounds.end })
        .orderBy('e.code', 'ASC')
        .getMany()
    ).filter((e) => !settled.has(e.id));
    const booked = await this.bookedProvisions(tenantId);
    const calculator = await this.settings.getCalculator(tenantId);

    const lines: EosProvisionLine[] = [];
    for (const employee of employees) {
      const term = employee.terminationDate ? String(employee.terminationDate) : null;
      const date = term && term < bounds.end ? term : bounds.end;
      const wage = this.employees.monthlyWage(employee);
      const gratuity = EndOfServiceService.liability(calculator, employee, wage, date);
      const liability = round(gratuity.amount, 2);
      const already = round(booked.get(employee.id) ?? 0, 2);
      const delta = round(liability - already, 2);
      if (!liability && !already) continue;
      lines.push(
        this.provisionLineRepo.create({
          employeeId: employee.id,
          employeeCode: employee.code,
          serviceYears: gratuity.serviceYears,
          monthlyWage: wage,
          liability,
          booked: already,
          delta,
          branchId: employee.branchId,
          costCenterId: employee.costCenterId ?? null,
        }),
      );
    }

    const provision = await this.provisionRepo.save(
      this.provisionRepo.create({
        tenantId,
        period: dto.period,
        postingDate,
        status: EosProvisionStatus.POSTED,
        employeeCount: lines.length,
        totalLiability: round(lines.reduce((s, l) => s + Number(l.liability), 0), 2),
        totalDelta: round(lines.reduce((s, l) => s + Number(l.delta), 0), 2),
        createdBy: userId,
        lines,
      }),
    );
    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date: postingDate,
      description: `End-of-service provision ${dto.period}`,
      sourceType: EOS_PROVISION_SOURCE,
      sourceId: provision.id,
      buildLines: () => EndOfServiceService.provisionLines(lines, accounts),
    });
    return this.findProvision(tenantId, provision.id);
  }

  /** Reverses the latest posted provision. */
  async reverseProvision(tenantId: string, userId: string, id: string, date?: string) {
    const provision = await this.findProvision(tenantId, id);
    if (provision.status !== EosProvisionStatus.POSTED) {
      throw new ConflictException('The provision is already reversed');
    }
    const posted = await this.provisionRepo.find({ where: { tenantId, status: EosProvisionStatus.POSTED } });
    if (posted.some((p) => p.period > provision.period)) {
      throw new ConflictException('Reverse the later provisions first');
    }
    await this.autoPosting.reverseSource(tenantId, userId, EOS_PROVISION_SOURCE, provision.id, date);
    await this.provisionRepo.update(provision.id, { status: EosProvisionStatus.REVERSED });
    return this.findProvision(tenantId, id);
  }

  // ------------------------------------------------------------ settlement

  findSettlements(tenantId: string, query: FinalSettlementQueryDto = {}) {
    const where: any = { tenantId };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.status) where.status = query.status;
    return this.settlementRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async findSettlement(tenantId: string, id: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id, tenantId } });
    if (!settlement) throw new NotFoundException('Final settlement not found');
    return settlement;
  }

  /** Computes and saves a draft settlement for a terminated employee. */
  async createSettlement(tenantId: string, userId: string, dto: CreateFinalSettlementDto) {
    const employee = await this.employees.findById(tenantId, dto.employeeId);
    if (employee.status !== EmployeeStatus.TERMINATED || !employee.terminationDate) {
      throw new BadRequestException('Terminate the employee before the final settlement');
    }
    const open = await this.settlementRepo.findOne({
      where: { tenantId, employeeId: employee.id, status: In(ACTIVE_SETTLEMENT) },
    });
    if (open) throw new ConflictException(`Settlement ${open.settlementNumber} already exists for the employee`);

    const terminationDate = String(employee.terminationDate);
    const rules = await this.settings.getRules(tenantId);
    const calculator = new PayrollCalculator(rules);
    const wage = this.employees.monthlyWage(employee);
    const gratuity = calculator.gratuity({
      country: employee.payrollCountry,
      monthlyWage: wage,
      startDate: String(employee.hireDate),
      endDate: terminationDate,
      reason: dto.reason,
    });

    // Remaining balance of the encashable paid leave types at the termination date.
    const dailyRate = round(wage / rules.general.daysPerMonth, 4);
    const leaveRows: { leaveTypeId: string; code: string; days: number; amount: number }[] = [];
    if (dto.encashLeave !== false) {
      const types = await this.leaveTypeRepo.find({ where: { tenantId, encashable: true, isPaid: true } });
      const year = Number(terminationDate.slice(0, 4));
      for (const type of types) {
        const balance = await this.leaves.balanceFor(tenantId, employee, type, year, terminationDate);
        if (balance.remaining > 0) {
          leaveRows.push({
            leaveTypeId: type.id,
            code: type.code,
            days: balance.remaining,
            amount: round(balance.remaining * dailyRate, 2),
          });
        }
      }
    }
    const leaveDays = round(leaveRows.reduce((s, r) => s + r.days, 0), 2);
    const leaveEncashment = round(leaveRows.reduce((s, r) => s + r.amount, 0), 2);

    // Last month's salary, unless the month is already in an approved payroll.
    const period = terminationDate.slice(0, 7);
    let lastSalary = dto.lastSalary;
    let lastSalaryNote = 'given';
    if (lastSalary === undefined) {
      const locked = await this.payrollLock.lockedPeriods(tenantId, employee.id, [period]);
      if (locked.length) {
        lastSalary = 0;
        lastSalaryNote = `${period} already paid by payroll`;
      } else {
        const bounds = periodBounds(period);
        const from = String(employee.hireDate) > bounds.start ? String(employee.hireDate) : bounds.start;
        lastSalary = round((wage * daysInclusive(from, terminationDate)) / bounds.days, 2);
        lastSalaryNote = `pro rata ${daysInclusive(from, terminationDate)}/${bounds.days} days of ${period}`;
      }
    }

    const otherAdditions = round((dto.additions ?? []).reduce((s, i) => s + i.amount, 0), 2);
    const otherDeductions = round((dto.deductions ?? []).reduce((s, i) => s + i.amount, 0), 2);
    const totalEarnings = round(gratuity.amount + leaveEncashment + lastSalary + otherAdditions, 2);
    const loanBalance = await this.loans.outstandingBalance(tenantId, employee.id);
    const loanDeduction = round(Math.min(loanBalance, Math.max(totalEarnings - otherDeductions, 0)), 2);
    const net = round(totalEarnings - otherDeductions - loanDeduction, 2);
    if (net < 0) throw new BadRequestException('Deductions exceed the settlement earnings');

    const settlementNumber = await this.sequenceService.next(tenantId, 'final_settlement', 'FS');
    return this.settlementRepo.save(
      this.settlementRepo.create({
        tenantId,
        settlementNumber,
        employeeId: employee.id,
        terminationDate,
        reason: dto.reason,
        status: FinalSettlementStatus.DRAFT,
        monthlyWage: wage,
        serviceYears: gratuity.serviceYears,
        gratuity: gratuity.amount,
        provisionUsed: 0,
        leaveDays,
        leaveEncashment,
        lastSalary,
        otherAdditions,
        loanDeduction,
        otherDeductions,
        totalEarnings,
        net,
        details: {
          gratuity,
          dailyRate,
          leave: leaveRows,
          lastSalaryNote,
          loanBalance,
          loanBalanceLeft: round(loanBalance - loanDeduction, 2),
          additions: dto.additions ?? [],
          deductions: dto.deductions ?? [],
        },
        notes: dto.notes,
        createdBy: userId,
      }),
    );
  }

  /** Posts a draft settlement (uses the booked EOS provision) and recovers the loans. */
  async postSettlement(tenantId: string, userId: string, id: string, dto: PostFinalSettlementDto = {}) {
    const settlement = await this.findSettlement(tenantId, id);
    if (settlement.status !== FinalSettlementStatus.DRAFT) {
      throw new ConflictException('Only draft settlements can be posted');
    }
    const employee = await this.employees.findById(tenantId, settlement.employeeId);
    const date = dto.date ?? settlement.terminationDate;
    await this.autoPosting.preflight(tenantId, date, [
      'salariesExpenseAccountId',
      'salariesPayableAccountId',
      ...(Number(settlement.loanDeduction) > 0 ? (['employeeAdvancesAccountId'] as const) : []),
    ]);
    const accounts = await this.settings.getAccounts(tenantId);
    const hasEos = !!(accounts.eosExpenseAccountId && accounts.eosProvisionAccountId);
    const booked = hasEos ? ((await this.bookedProvisions(tenantId, [employee.id])).get(employee.id) ?? 0) : 0;
    settlement.provisionUsed = round(Math.max(booked, 0), 2);

    const recoveries: InstallmentRecovery[] =
      Number(settlement.loanDeduction) > 0
        ? await this.loans.allocateOutstanding(tenantId, employee.id, Number(settlement.loanDeduction))
        : [];
    const recovered = round(recoveries.reduce((s, r) => s + r.amount, 0), 2);
    if (Math.abs(recovered - Number(settlement.loanDeduction)) > 0.01) {
      throw new ConflictException('The loan balance changed since the settlement was computed; recreate it');
    }

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date,
      description: `Final settlement ${settlement.settlementNumber}`,
      sourceType: SETTLEMENT_SOURCE,
      sourceId: settlement.id,
      buildLines: (_s, account) =>
        EndOfServiceService.settlementLines(settlement, accounts, account, {
          branchId: employee.branchId ?? undefined,
          costCenterId: employee.costCenterId ?? undefined,
        }),
    });
    if (recoveries.length) await this.loans.applyRecoveries(tenantId, recoveries, 1);

    settlement.status = FinalSettlementStatus.POSTED;
    settlement.postingDate = date;
    settlement.details = { ...settlement.details, recoveries };
    return this.settlementRepo.save(settlement);
  }

  async paySettlement(tenantId: string, userId: string, id: string, dto: PayFinalSettlementDto) {
    const settlement = await this.findSettlement(tenantId, id);
    if (settlement.status !== FinalSettlementStatus.POSTED) {
      throw new ConflictException('Only posted settlements can be paid');
    }
    const liquidityKey = dto.paymentMethod === HrPaymentMethod.CASH ? 'cashAccountId' : 'bankAccountId';
    await this.autoPosting.preflight(tenantId, dto.date, ['salariesPayableAccountId', liquidityKey]);
    const net = Number(settlement.net);
    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: dto.paymentMethod === HrPaymentMethod.CASH ? JournalType.CASH : JournalType.BANK,
      date: dto.date,
      description: `Final settlement payment ${settlement.settlementNumber}`,
      sourceType: SETTLEMENT_PAYMENT_SOURCE,
      sourceId: settlement.id,
      buildLines: (_s, account) => [
        { accountId: account('salariesPayableAccountId'), debit: net },
        { accountId: account(liquidityKey), credit: net },
      ],
    });
    settlement.status = FinalSettlementStatus.PAID;
    settlement.paidDate = dto.date;
    settlement.paymentMethod = dto.paymentMethod;
    return this.settlementRepo.save(settlement);
  }

  /** Cancels a draft, or reverses a posted/paid settlement (loans restored). */
  async cancelSettlement(tenantId: string, userId: string, id: string, dto: CancelFinalSettlementDto = {}) {
    const settlement = await this.findSettlement(tenantId, id);
    if (settlement.status === FinalSettlementStatus.CANCELLED) {
      throw new ConflictException('The settlement is already cancelled');
    }
    if (settlement.status === FinalSettlementStatus.PAID) {
      await this.autoPosting.reverseSource(tenantId, userId, SETTLEMENT_PAYMENT_SOURCE, settlement.id, dto.date);
    }
    if (BOOKED_SETTLEMENT.includes(settlement.status)) {
      await this.autoPosting.reverseSource(tenantId, userId, SETTLEMENT_SOURCE, settlement.id, dto.date);
      const recoveries = (settlement.details?.recoveries as InstallmentRecovery[]) ?? [];
      if (recoveries.length) await this.loans.applyRecoveries(tenantId, recoveries, -1);
    }
    settlement.status = FinalSettlementStatus.CANCELLED;
    return this.settlementRepo.save(settlement);
  }
}
