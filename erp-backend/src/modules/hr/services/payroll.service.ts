import { HrPaymentSourceService } from './hr-payment-source.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Like, Repository } from 'typeorm';
import { PayrollRun, PayrollRunStatus } from '../entities/payroll-run.entity';
import { PayrollLine } from '../entities/payroll-line.entity';
import { AdjustmentKind, PayrollAdjustment } from '../entities/payroll-adjustment.entity';
import { Employee, PayrollCountry } from '../entities/employee.entity';
import { HrPaymentMethod } from '../entities/employee-loan.entity';
import {
  ApprovePayrollRunDto,
  CreatePayrollAdjustmentDto,
  CreatePayrollRunDto,
  PayPayrollRunDto,
  PayrollAdjustmentQueryDto,
  PayrollRunQueryDto,
  ReversePayrollRunDto,
} from '../dto/payroll.dto';
import { EmployeesService } from './employees.service';
import { AttendanceService } from './attendance.service';
import { LoansService, InstallmentRecovery } from './loans.service';
import { HrSettingsService } from './hr-settings.service';
import { PayrollCalculator, PayslipResult, TaxYtdInput } from '../calculators/payroll-calculator';
import { PayrollRules } from '../calculators/payroll-rules';
import { resolveOvertime } from '../calculators/overtime-calculator';
import { BankFileFormat, BankFileRow, buildBankFile } from '../calculators/bank-file';
import { OvertimeService } from './overtime.service';
import { AutoPostingService, PostingLine } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round } from '@shared/utils/document-totals.util';

const ACTIVE_RUN = [PayrollRunStatus.DRAFT, PayrollRunStatus.APPROVED, PayrollRunStatus.PAID];
const POSTED_RUN = [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID];

export function periodBounds(period: string): { start: string; end: string; days: number } {
  const [year, month] = period.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { start: `${period}-01`, end: `${year}-${mm}-${String(days).padStart(2, '0')}`, days };
}

const sumBy = <T>(items: T[], pick: (item: T) => number) =>
  round(
    items.reduce((s, i) => s + Number(pick(i) || 0), 0),
    4,
  );

/**
 * Monthly payroll runs: draft (computed, adjustments editable, recompute)
 * -> approved (accrual journal entry, loan installments recovered)
 * -> paid (salaries paid from cash/bank). Drafts can be cancelled and
 * approved/paid runs reversed.
 */
@Injectable()
export class PayrollService {
  constructor(
    @InjectRepository(PayrollRun)
    private readonly runRepo: Repository<PayrollRun>,
    @InjectRepository(PayrollLine)
    private readonly lineRepo: Repository<PayrollLine>,
    @InjectRepository(PayrollAdjustment)
    private readonly adjustmentRepo: Repository<PayrollAdjustment>,
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    private readonly employees: EmployeesService,
    private readonly attendance: AttendanceService,
    private readonly loans: LoansService,
    private readonly settings: HrSettingsService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
    private readonly overtime: OvertimeService,
    @Optional() private readonly paymentSource?: HrPaymentSourceService,
  ) {}

  // ------------------------------------------------------------ adjustments

  findAdjustments(tenantId: string, query: PayrollAdjustmentQueryDto = {}) {
    const where: any = { tenantId };
    if (query.period) where.period = query.period;
    if (query.employeeId) where.employeeId = query.employeeId;
    return this.adjustmentRepo.find({ where, order: { period: 'DESC', createdAt: 'ASC' } });
  }

  async createAdjustment(tenantId: string, userId: string, dto: CreatePayrollAdjustmentDto) {
    await this.employees.findById(tenantId, dto.employeeId);
    await this.assertPeriodOpenForEmployee(tenantId, dto.employeeId, dto.period);
    return this.adjustmentRepo.save(
      this.adjustmentRepo.create({
        tenantId,
        employeeId: dto.employeeId,
        period: dto.period,
        kind: dto.kind,
        category: dto.category ?? (dto.kind === AdjustmentKind.ADDITION ? 'bonus' : 'other'),
        description: dto.description,
        amount: round(dto.amount, 2),
        taxable: dto.taxable ?? true,
        createdBy: userId,
      }),
    );
  }

  async deleteAdjustment(tenantId: string, id: string) {
    const adjustment = await this.adjustmentRepo.findOne({ where: { id, tenantId } });
    if (!adjustment) throw new NotFoundException('Payroll adjustment not found');
    if (adjustment.payrollRunId) {
      throw new ConflictException('The adjustment belongs to an approved payroll run');
    }
    await this.adjustmentRepo.delete({ id, tenantId });
    return { deleted: true };
  }

  // ------------------------------------------------------------ runs

  findAll(tenantId: string, query: PayrollRunQueryDto = {}) {
    const where: any = { tenantId };
    if (query.period) where.period = query.period;
    if (query.status) where.status = query.status;
    return this.runRepo.find({ where, order: { period: 'DESC', createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string): Promise<PayrollRun> {
    const run = await this.runRepo.findOne({ where: { id, tenantId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    run.lines = await this.lineRepo.find({ where: { runId: run.id }, order: { employeeCode: 'ASC' } });
    return run;
  }

  async create(tenantId: string, userId: string, dto: CreatePayrollRunDto): Promise<PayrollRun> {
    const bounds = periodBounds(dto.period);
    const runNumber = await this.sequenceService.next(tenantId, 'payroll_run', 'PAY');
    const run = await this.runRepo.save(
      this.runRepo.create({
        tenantId,
        runNumber,
        period: dto.period,
        periodStart: bounds.start,
        periodEnd: bounds.end,
        branchId: dto.branchId ?? null,
        departmentId: dto.departmentId ?? null,
        status: PayrollRunStatus.DRAFT,
        notes: dto.notes,
        createdBy: userId,
      }),
    );
    await this.compute(tenantId, run);
    if (!run.employeeCount) {
      // Thrown errors roll back the request transaction, so no empty run is kept.
      throw new BadRequestException(
        `No employee to pay for ${dto.period}: none matches the filters or all are in another active run`,
      );
    }
    return this.findById(tenantId, run.id);
  }

  async recompute(tenantId: string, id: string): Promise<PayrollRun> {
    const run = await this.findById(tenantId, id);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new ConflictException('Only draft payroll runs can be recomputed');
    }
    await this.compute(tenantId, run);
    return this.findById(tenantId, id);
  }

  /**
   * Approves a draft: recomputes it against the latest data, posts the
   * accrual entry, consumes the month's adjustments and recovers the loan
   * installments.
   */
  async approve(tenantId: string, userId: string, id: string, dto: ApprovePayrollRunDto = {}) {
    const run = await this.findById(tenantId, id);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new ConflictException('Only draft payroll runs can be approved');
    }
    const postingDate = dto.postingDate ?? run.periodEnd;
    await this.autoPosting.preflight(tenantId, postingDate, [
      'salariesExpenseAccountId',
      'salariesPayableAccountId',
      'socialInsuranceExpenseAccountId',
      'socialInsurancePayableAccountId',
      'payrollTaxPayableAccountId',
      'employeeAdvancesAccountId',
    ]);

    await this.compute(tenantId, run);
    const lines = await this.lineRepo.find({ where: { runId: run.id } });
    if (!lines.length) throw new BadRequestException('The payroll run has no employees');

    await this.postAccrual(tenantId, userId, run, lines, postingDate);

    const adjustmentIds = lines.flatMap((l) => (l.details?.adjustmentIds as string[]) ?? []);
    if (adjustmentIds.length) {
      await this.adjustmentRepo.update({ id: In(adjustmentIds), tenantId }, { payrollRunId: run.id });
    }
    await this.loans.applyRecoveries(tenantId, this.recoveries(lines), 1);

    await this.runRepo.update(run.id, {
      status: PayrollRunStatus.APPROVED,
      approvedBy: userId,
      approvedAt: new Date(),
      postingDate,
    });
    return this.findById(tenantId, id);
  }

  /** Pays the net salaries: Dr salaries payable / Cr cash or bank. */
  async pay(tenantId: string, userId: string, id: string, dto: PayPayrollRunDto) {
    const run = await this.findById(tenantId, id);
    if (run.status !== PayrollRunStatus.APPROVED) {
      throw new ConflictException('Only approved payroll runs can be paid');
    }
    const net = Number(run.totalNet);
    const source = await this.paymentSourceFor(tenantId, userId, dto, net);
    await this.autoPosting.preflight(tenantId, dto.date, [
      'salariesPayableAccountId',
      ...(source.settingsKey ? [source.settingsKey] : []),
    ]);

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: source.journalType,
      date: dto.date,
      description: `Salaries payment ${run.runNumber} (${run.period})`,
      sourceType: 'payroll_payment',
      sourceId: run.id,
      buildLines: (_s, account) => [
        { accountId: account('salariesPayableAccountId'), debit: net },
        { accountId: HrPaymentSourceService.account(source, account), credit: net },
      ],
    });
    await this.runRepo.update(run.id, {
      status: PayrollRunStatus.PAID,
      paidDate: dto.date,
      paymentMethod: dto.paymentMethod,
    });
    return this.findById(tenantId, id);
  }

  async cancel(tenantId: string, id: string) {
    const run = await this.findById(tenantId, id);
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new ConflictException('Only draft payroll runs can be cancelled; reverse approved runs');
    }
    await this.runRepo.update(run.id, { status: PayrollRunStatus.CANCELLED });
    return this.findById(tenantId, id);
  }

  /**
   * Reverses an approved or paid run: reverses its journal entries, gives
   * the loan installments back and frees the adjustments for a new run.
   */
  async reverse(tenantId: string, userId: string, id: string, dto: ReversePayrollRunDto = {}) {
    const run = await this.findById(tenantId, id);
    if (!POSTED_RUN.includes(run.status)) {
      throw new ConflictException('Only approved or paid payroll runs can be reversed');
    }
    if (run.status === PayrollRunStatus.PAID) {
      await this.autoPosting.reverseSource(tenantId, userId, 'payroll_payment', run.id, dto.date);
    }
    await this.autoPosting.reverseSource(tenantId, userId, 'payroll_run', run.id, dto.date);
    await this.loans.applyRecoveries(tenantId, this.recoveries(run.lines), -1);
    await this.adjustmentRepo.update({ tenantId, payrollRunId: run.id }, { payrollRunId: null });
    await this.runRepo.update(run.id, { status: PayrollRunStatus.REVERSED });
    return this.findById(tenantId, id);
  }

  // ------------------------------------------------------------ outputs

  async payslip(tenantId: string, runId: string, employeeId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    const line = await this.lineRepo.findOne({ where: { runId, employeeId } });
    if (!line) throw new NotFoundException('Employee is not part of this payroll run');
    const employee = await this.employees.findById(tenantId, employeeId);
    return {
      run: {
        id: run.id,
        runNumber: run.runNumber,
        period: run.period,
        periodStart: run.periodStart,
        periodEnd: run.periodEnd,
        status: run.status,
      },
      employee: {
        id: employee.id,
        code: employee.code,
        nameEn: employee.nameEn,
        nameAr: employee.nameAr,
        nationalId: employee.nationalId,
        nationality: employee.nationality,
        departmentId: employee.departmentId,
        jobTitleId: employee.jobTitleId,
        bankName: employee.bankName,
        iban: employee.iban,
        socialInsuranceNumber: employee.socialInsuranceNumber,
        payrollCountry: employee.payrollCountry,
      },
      summary: {
        basic: Number(line.basic),
        allowances: Number(line.allowancesTotal),
        overtime: Number(line.overtimePay),
        additions: Number(line.additionsTotal),
        attendanceDeductions: Number(line.attendanceDeductions),
        gross: Number(line.gross),
        employeeSocialInsurance: Number(line.employeeSi),
        employerSocialInsurance: Number(line.employerSi),
        incomeTax: Number(line.incomeTax),
        martyrsFund: Number(line.martyrsFund ?? 0),
        loans: Number(line.loanDeduction),
        otherDeductions: Number(line.otherDeductions),
        totalDeductions: Number(line.totalDeductions),
        net: Number(line.net),
      },
      breakdown: line.details,
    };
  }

  async register(tenantId: string, runId: string) {
    const run = await this.findById(tenantId, runId);
    const lines = run.lines.map((l) => ({
      employeeId: l.employeeId,
      employeeCode: l.employeeCode,
      employeeName: l.employeeName,
      departmentId: l.departmentId,
      branchId: l.branchId,
      payrollCountry: l.payrollCountry,
      basic: Number(l.basic),
      allowances: Number(l.allowancesTotal),
      overtime: Number(l.overtimePay),
      additions: Number(l.additionsTotal),
      attendanceDeductions: Number(l.attendanceDeductions),
      gross: Number(l.gross),
      employeeSi: Number(l.employeeSi),
      employerSi: Number(l.employerSi),
      incomeTax: Number(l.incomeTax),
      martyrsFund: Number(l.martyrsFund ?? 0),
      martyrsFundEmployer: Number(l.martyrsFundEmployer ?? 0),
      loans: Number(l.loanDeduction),
      otherDeductions: Number(l.otherDeductions),
      net: Number(l.net),
      costCenterId: l.costCenterId ?? null,
    }));
    const keys = [
      'basic',
      'allowances',
      'overtime',
      'additions',
      'attendanceDeductions',
      'gross',
      'employeeSi',
      'employerSi',
      'incomeTax',
      'martyrsFund',
      'martyrsFundEmployer',
      'loans',
      'otherDeductions',
      'net',
    ] as const;
    const totals = Object.fromEntries(keys.map((k) => [k, sumBy(lines, (l) => l[k])]));
    const costCenters = [...new Set(lines.map((l) => l.costCenterId))];
    const byCostCenter = costCenters.map((costCenterId) => {
      const subset = lines.filter((l) => l.costCenterId === costCenterId);
      return {
        costCenterId,
        employees: subset.length,
        gross: sumBy(subset, (l) => l.gross),
        employerSi: sumBy(subset, (l) => l.employerSi),
        net: sumBy(subset, (l) => l.net),
      };
    });
    const { lines: _omit, ...header } = run;
    return { run: header, lines, totals, byCostCenter };
  }

  /** Social insurance contributions of the approved/paid runs of a month. */
  async socialInsuranceReport(tenantId: string, period: string) {
    const runs = await this.runRepo.find({ where: { tenantId, period, status: In(POSTED_RUN) } });
    const lines = runs.length
      ? await this.lineRepo.find({
          where: { runId: In(runs.map((r) => r.id)) },
          order: { employeeCode: 'ASC' },
        })
      : [];
    const employees = lines.length
      ? await this.employeeRepo.find({ where: { tenantId, id: In(lines.map((l) => l.employeeId)) } })
      : [];
    const byId = new Map(employees.map((e) => [e.id, e]));
    const rows = lines
      .filter((l) => Number(l.employeeSi) > 0 || Number(l.employerSi) > 0)
      .map((l) => {
        const e = byId.get(l.employeeId);
        return {
          employeeId: l.employeeId,
          employeeCode: l.employeeCode,
          employeeName: l.employeeName,
          nationalId: e?.nationalId ?? null,
          nationality: e?.nationality ?? null,
          socialInsuranceNumber: e?.socialInsuranceNumber ?? null,
          payrollCountry: l.payrollCountry,
          insurableWage: Number(l.insurableWage),
          employeeShare: Number(l.employeeSi),
          employerShare: Number(l.employerSi),
          total: round(Number(l.employeeSi) + Number(l.employerSi), 2),
        };
      });
    const byCountry = Object.values(PayrollCountry).map((country) => {
      const subset = rows.filter((r) => r.payrollCountry === country);
      return {
        country,
        employees: subset.length,
        insurableWage: sumBy(subset, (r) => r.insurableWage),
        employeeShare: sumBy(subset, (r) => r.employeeShare),
        employerShare: sumBy(subset, (r) => r.employerShare),
        total: sumBy(subset, (r) => r.total),
      };
    });
    return { period, runs: runs.map((r) => r.runNumber), rows, totals: byCountry };
  }

  // ------------------------------------------------------------ computation

  private async compute(tenantId: string, run: PayrollRun): Promise<void> {
    const rules = await this.settings.getRules(tenantId);
    const calculator = new PayrollCalculator(rules);
    const bounds = periodBounds(run.period);
    const employees = await this.eligibleEmployees(tenantId, run);
    const ytd = await this.taxYearToDate(tenantId, run);

    await this.lineRepo.delete({ runId: run.id });
    const lines: PayrollLine[] = [];
    for (const employee of employees) {
      lines.push(
        await this.computeLine(tenantId, run, employee, calculator, rules, bounds, ytd.get(employee.id)),
      );
    }
    if (lines.length) await this.lineRepo.save(lines);

    run.employeeCount = lines.length;
    run.totalGross = sumBy(lines, (l) => l.gross);
    run.totalEmployeeSi = sumBy(lines, (l) => l.employeeSi);
    run.totalEmployerSi = sumBy(lines, (l) => l.employerSi);
    run.totalTax = sumBy(lines, (l) => l.incomeTax);
    run.totalLoans = sumBy(lines, (l) => l.loanDeduction);
    run.totalOtherDeductions = sumBy(lines, (l) => l.otherDeductions);
    run.totalNet = sumBy(lines, (l) => l.net);
    run.computedAt = new Date();
    await this.runRepo.update(run.id, {
      employeeCount: run.employeeCount,
      totalGross: run.totalGross,
      totalEmployeeSi: run.totalEmployeeSi,
      totalEmployerSi: run.totalEmployerSi,
      totalTax: run.totalTax,
      totalLoans: run.totalLoans,
      totalOtherDeductions: run.totalOtherDeductions,
      totalNet: run.totalNet,
      computedAt: run.computedAt,
    });
  }

  /**
   * Employees employed during the period (and in the run's branch/department)
   * that are not already part of another active run of the same month.
   */
  private async eligibleEmployees(tenantId: string, run: PayrollRun): Promise<Employee[]> {
    const qb = this.employeeRepo
      .createQueryBuilder('e')
      .where('e.tenant_id = :tenantId', { tenantId })
      .andWhere('e.hire_date <= :end', { end: run.periodEnd })
      .andWhere('(e.termination_date IS NULL OR e.termination_date >= :start)', {
        start: run.periodStart,
      })
      .orderBy('e.code', 'ASC');
    if (run.branchId) qb.andWhere('e.branch_id = :branchId', { branchId: run.branchId });
    if (run.departmentId) {
      qb.andWhere('e.department_id = :departmentId', { departmentId: run.departmentId });
    }
    const employees = await qb.getMany();

    const otherRuns = await this.runRepo.find({
      where: { tenantId, period: run.period, status: In(ACTIVE_RUN) },
    });
    const otherIds = otherRuns.filter((r) => r.id !== run.id).map((r) => r.id);
    if (!otherIds.length) return employees;
    const taken = await this.lineRepo.find({ where: { runId: In(otherIds) } });
    const takenIds = new Set(taken.map((l) => l.employeeId));
    return employees.filter((e) => !takenIds.has(e.id));
  }

  private async computeLine(
    tenantId: string,
    run: PayrollRun,
    employee: Employee,
    calculator: PayrollCalculator,
    rules: PayrollRules,
    bounds: { start: string; end: string; days: number },
    taxYtd?: TaxYtdInput,
  ): Promise<PayrollLine> {
    const from = String(employee.hireDate) > bounds.start ? String(employee.hireDate) : bounds.start;
    const to =
      employee.terminationDate && String(employee.terminationDate) < bounds.end
        ? String(employee.terminationDate)
        : bounds.end;
    const employedDays =
      Math.round(
        (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000,
      ) + 1;

    const attendance = await this.attendance.summarize(tenantId, employee, from, to);
    const adjustments = await this.adjustmentRepo.find({
      where: { tenantId, employeeId: employee.id, period: run.period, payrollRunId: IsNull() },
      order: { createdAt: 'ASC' },
    });
    const installments = await this.loans.dueInstallments(tenantId, employee.id, run.period);
    const overtime = resolveOvertime({
      mode: rules.general.overtimeMode,
      tracked: employee.trackAttendance,
      attendanceByDate: new Map(
        (attendance.days ?? []).filter((d) => d.overtimeHours > 0).map((d) => [d.date, d.overtimeHours]),
      ),
      approved: await this.overtime.approvedBetween(tenantId, employee.id, from, to),
    });

    const result: PayslipResult = calculator.computePayslip({
      country: employee.payrollCountry,
      basicSalary: Number(employee.basicSalary),
      allowances: employee.allowances ?? [],
      daysInMonth: bounds.days,
      employedDays,
      dailyHours: attendance.schedule.dailyHours,
      overtimeHours: overtime.hours,
      absenceDays: attendance.absenceDays,
      unpaidLeaveDays: attendance.unpaidLeaveDays,
      lateMinutes: attendance.lateMinutes,
      additions: adjustments
        .filter((a) => a.kind === AdjustmentKind.ADDITION)
        .map((a) => ({ description: a.description, amount: Number(a.amount), taxable: a.taxable })),
      deductions: adjustments
        .filter((a) => a.kind === AdjustmentKind.DEDUCTION)
        .map((a) => ({ description: a.description, amount: Number(a.amount) })),
      socialInsurance: {
        enrolled: employee.socialInsuranceEnrolled,
        insurableWage:
          employee.socialInsuranceWage != null ? Number(employee.socialInsuranceWage) : null,
        isNational: String(employee.nationality).toUpperCase() === employee.payrollCountry,
      },
      loanInstallments: installments,
      taxYtd:
        employee.payrollCountry === PayrollCountry.EG
          ? (taxYtd ?? { monthsBefore: 0, regularTaxableBefore: 0, irregularTaxableBefore: 0, taxBefore: 0 })
          : undefined,
    });

    return this.lineRepo.create({
      runId: run.id,
      employeeId: employee.id,
      employeeCode: employee.code,
      employeeName: employee.nameEn,
      payrollCountry: employee.payrollCountry,
      branchId: employee.branchId,
      departmentId: employee.departmentId,
      costCenterId: employee.costCenterId ?? null,
      basic: result.earnings.basic,
      allowancesTotal: result.earnings.allowancesTotal,
      overtimePay: result.earnings.overtimePay,
      additionsTotal: result.earnings.additionsTotal,
      attendanceDeductions: result.attendanceDeductions.total,
      gross: result.gross,
      insurableWage: result.socialInsurance.wage,
      employeeSi: result.socialInsurance.employee,
      employerSi: result.socialInsurance.employer,
      incomeTax: result.incomeTax.monthlyTax,
      martyrsFund: result.martyrsFund.employee,
      martyrsFundEmployer: result.martyrsFund.employer,
      loanDeduction: result.loanDeduction,
      otherDeductions: result.otherDeductionsTotal,
      totalDeductions: result.totalDeductions,
      net: result.net,
      details: {
        ...result,
        employedFrom: from,
        employedTo: to,
        employedDays,
        attendance: {
          workingDays: attendance.workingDays,
          presentDays: attendance.presentDays,
          absenceDays: attendance.absenceDays,
          paidLeaveDays: attendance.paidLeaveDays,
          unpaidLeaveDays: attendance.unpaidLeaveDays,
          lateMinutes: attendance.lateMinutes,
          overtimeHours: attendance.overtimeHours,
          tracked: employee.trackAttendance,
        },
        overtime,
        adjustmentIds: adjustments.map((a) => a.id),
      },
    });
  }

  /**
   * Egyptian tax year-to-date per employee: the approved/paid payslips of
   * the same calendar year before the run's month.
   */
  private async taxYearToDate(tenantId: string, run: PayrollRun): Promise<Map<string, TaxYtdInput>> {
    const year = run.period.slice(0, 4);
    const runs = (
      await this.runRepo.find({
        where: { tenantId, period: Like(`${year}-%`), status: In(POSTED_RUN) },
      })
    ).filter((r) => r.id !== run.id && r.period.startsWith(`${year}-`) && r.period < run.period);
    const result = new Map<string, TaxYtdInput>();
    if (!runs.length) return result;
    const periodOf = new Map(runs.map((r) => [r.id, r.period]));
    const lines = await this.lineRepo.find({ where: { runId: In(runs.map((r) => r.id)) } });
    const months = new Map<string, Set<string>>();
    for (const line of lines) {
      if (line.payrollCountry !== PayrollCountry.EG) continue;
      const tax = (line.details?.incomeTax ?? {}) as Record<string, number>;
      const current = result.get(line.employeeId) ?? {
        monthsBefore: 0,
        regularTaxableBefore: 0,
        irregularTaxableBefore: 0,
        taxBefore: 0,
      };
      current.regularTaxableBefore = round(
        current.regularTaxableBefore + Number(tax.regularTaxable ?? tax.monthlyTaxable ?? 0),
        2,
      );
      current.irregularTaxableBefore = round(current.irregularTaxableBefore + Number(tax.irregularTaxable ?? 0), 2);
      current.taxBefore = round(current.taxBefore + Number(line.incomeTax), 2);
      const set = months.get(line.employeeId) ?? new Set<string>();
      set.add(periodOf.get(line.runId) as string);
      months.set(line.employeeId, set);
      current.monthsBefore = set.size;
      result.set(line.employeeId, current);
    }
    return result;
  }

  /**
   * Salary transfer file of an approved/paid run: a generic bank sheet
   * (one row per employee with IBAN and net) or a Saudi WPS / Mudad-style
   * payroll file. Employees can be filtered by bank name.
   */
  async bankFile(
    tenantId: string,
    runId: string,
    options: { format?: BankFileFormat; bankName?: string; valueDate?: string } = {},
  ) {
    const run = await this.findById(tenantId, runId);
    if (!POSTED_RUN.includes(run.status)) {
      throw new ConflictException('Only approved or paid payroll runs can be exported to the bank');
    }
    const employees = run.lines.length
      ? await this.employeeRepo.find({ where: { tenantId, id: In(run.lines.map((l) => l.employeeId)) } })
      : [];
    const byId = new Map(employees.map((e) => [e.id, e]));
    const filter = options.bankName?.trim().toLowerCase();
    const rows: BankFileRow[] = [];
    for (const line of run.lines) {
      const employee = byId.get(line.employeeId);
      if (!employee || Number(line.net) <= 0) continue;
      if (filter && !String(employee.bankName ?? '').toLowerCase().includes(filter)) continue;
      const allowances = ((line.details?.earnings?.allowances ?? []) as { code: string; amount: number }[]);
      rows.push({
        employeeCode: employee.code,
        employeeName: employee.nameEn,
        employeeNameAr: employee.nameAr,
        nationalId: employee.nationalId,
        bankName: employee.bankName,
        bankAccount: employee.bankAccount,
        iban: employee.iban,
        basic: Number(line.basic),
        housing: allowances
          .filter((a) => String(a.code).toLowerCase() === 'housing')
          .reduce((s, a) => s + Number(a.amount), 0),
        gross: Number(line.gross),
        deductions: Number(line.totalDeductions),
        net: Number(line.net),
      });
    }
    const file = buildBankFile(options.format ?? 'generic', rows, {
      reference: run.runNumber,
      period: run.period,
      valueDate: options.valueDate ?? run.paidDate ?? run.periodEnd,
    });
    return {
      runId: run.id,
      runNumber: run.runNumber,
      period: run.period,
      bankName: options.bankName ?? null,
      ...file,
    };
  }

  /** Self-service: the employee's payslips of approved/paid runs. */
  async payslipsOf(tenantId: string, employeeId: string) {
    const lines = await this.lineRepo.find({ where: { employeeId }, relations: ['run'] });
    return lines
      .filter((l) => l.run && l.run.tenantId === tenantId && POSTED_RUN.includes(l.run.status))
      .sort((a, b) => b.run.period.localeCompare(a.run.period))
      .map((l) => ({
        runId: l.runId,
        runNumber: l.run.runNumber,
        period: l.run.period,
        status: l.run.status,
        gross: Number(l.gross),
        totalDeductions: Number(l.totalDeductions),
        net: Number(l.net),
      }));
  }

  private recoveries(lines: PayrollLine[]): InstallmentRecovery[] {
    return lines.flatMap(
      (l) => ((l.details?.loanAllocations as InstallmentRecovery[]) ?? []).filter((a) => a.amount > 0),
    );
  }

  /**
   * Accrual entry, per branch:
   *   Dr salaries expense (gross)           Cr social insurance payable (employee + employer)
   *   Dr social insurance expense (employer) Cr payroll tax payable
   *                                          Cr employee advances (loan installments)
   *                                          Cr salaries expense (one-off deductions/penalties)
   *                                          Cr salaries payable (net)
   */
  private async postAccrual(
    tenantId: string,
    userId: string,
    run: PayrollRun,
    lines: PayrollLine[],
    date: string,
  ) {
    const hrAccounts = await this.settings.getAccounts(tenantId);
    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date,
      description: `Payroll ${run.runNumber} (${run.period})`,
      sourceType: 'payroll_run',
      sourceId: run.id,
      buildLines: (_s, account) =>
        PayrollService.accrualLines(lines, account, hrAccounts.martyrsFundAccountId),
    });
  }

  /**
   * Accrual lines per employee (branch and cost center kept on the expense
   * lines). A negative month tax (year-end true-up refund) is debited.
   */
  static accrualLines(
    lines: PayrollLine[],
    account: (key: any) => string,
    martyrsFundAccountId?: string | null,
  ): PostingLine[] {
    const out: PostingLine[] = [];
    for (const l of lines) {
      const branchId = l.branchId ?? undefined;
      const costCenterId = l.costCenterId ?? undefined;
      const employeeSi = Number(l.employeeSi);
      const employerSi = Number(l.employerSi);
      const tax = Number(l.incomeTax);
      const fundEmployee = Number(l.martyrsFund ?? 0);
      const fundEmployer = Number(l.martyrsFundEmployer ?? 0);
      const fundAccount = martyrsFundAccountId || account('payrollTaxPayableAccountId');
      out.push(
        {
          accountId: account('salariesExpenseAccountId'),
          debit: round(Number(l.gross) + fundEmployer, 4),
          branchId,
          costCenterId,
        },
        { accountId: account('socialInsuranceExpenseAccountId'), debit: employerSi, branchId, costCenterId },
        {
          accountId: account('socialInsurancePayableAccountId'),
          credit: round(employeeSi + employerSi, 4),
          branchId,
        },
        tax >= 0
          ? { accountId: account('payrollTaxPayableAccountId'), credit: tax, branchId }
          : { accountId: account('payrollTaxPayableAccountId'), debit: -tax, branchId },
        { accountId: fundAccount, credit: round(fundEmployee + fundEmployer, 4), branchId },
        { accountId: account('employeeAdvancesAccountId'), credit: Number(l.loanDeduction), branchId },
        {
          accountId: account('salariesExpenseAccountId'),
          credit: Number(l.otherDeductions),
          branchId,
          costCenterId,
        },
        { accountId: account('salariesPayableAccountId'), credit: Number(l.net), branchId },
      );
    }
    return out;
  }

  private async assertPeriodOpenForEmployee(tenantId: string, employeeId: string, period: string) {
    const runs = await this.runRepo.find({ where: { tenantId, period, status: In(POSTED_RUN) } });
    if (!runs.length) return;
    const line = await this.lineRepo.findOne({
      where: { runId: In(runs.map((r) => r.id)), employeeId },
    });
    if (line) {
      throw new ConflictException(
        `The ${period} payroll of this employee is already approved; reverse it or use the next month`,
      );
    }
  }

  private paymentSourceFor(
    tenantId: string,
    userId: string,
    dto: { paymentMethod: HrPaymentMethod; treasuryId?: string; date: string },
    amount: number,
  ) {
    if (this.paymentSource) return this.paymentSource.resolve(tenantId, userId, dto, amount);
    const cash = dto.paymentMethod === HrPaymentMethod.CASH;
    return Promise.resolve({
      journalType: cash ? JournalType.CASH : JournalType.BANK,
      settingsKey: (cash ? 'cashAccountId' : 'bankAccountId') as 'cashAccountId' | 'bankAccountId',
    } as import('./hr-payment-source.service').HrPaymentSource);
  }
}
