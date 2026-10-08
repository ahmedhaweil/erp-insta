import api from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */
const data = <T = any>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export type PayrollCountry = 'EG' | 'SA';
export type HrPaymentMethod = 'cash' | 'bank';

export interface Department {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  parentId?: string | null;
  branchId?: string | null;
  managerId?: string | null;
  isActive: boolean;
}

export interface JobTitle {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  isActive: boolean;
}

export interface WorkSchedule {
  id: string;
  name: string;
  dailyHours: number | string;
  startTime: string;
  weekendDays: number[];
  graceMinutes: number;
  isDefault: boolean;
}

export interface PublicHoliday {
  id: string;
  date: string;
  name: string;
}

export interface Allowance {
  code: string;
  name: string;
  amount: number;
}

export interface Employee {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  idType: 'national_id' | 'iqama' | 'passport';
  nationalId?: string | null;
  nationality: string;
  birthDate?: string | null;
  gender?: string | null;
  email?: string | null;
  phone?: string | null;
  hireDate: string;
  branchId?: string | null;
  departmentId?: string | null;
  jobTitleId?: string | null;
  managerId?: string | null;
  workScheduleId?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  iban?: string | null;
  contractType: 'permanent' | 'fixed_term' | 'part_time' | 'temporary';
  contractEndDate?: string | null;
  status: 'active' | 'terminated';
  terminationDate?: string | null;
  terminationReason?: string | null;
  basicSalary: number | string;
  allowances: Allowance[];
  socialInsuranceWage?: number | string | null;
  socialInsuranceNumber?: string | null;
  socialInsuranceEnrolled: boolean;
  payrollCountry: PayrollCountry;
  trackAttendance: boolean;
  userId?: string | null;
  costCenterId?: string | null;
}

export interface LeaveEncashment {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  days: number | string;
  dailyRate: number | string;
  amount: number | string;
  period: string;
  status: 'approved' | 'cancelled';
  payrollAdjustmentId: string | null;
  notes: string | null;
  createdAt: string;
}

export type OvertimeStatus = 'draft' | 'approved' | 'rejected' | 'cancelled';

export interface OvertimeRequest {
  id: string;
  employeeId: string;
  date: string;
  hours: number | string;
  reason: string | null;
  status: OvertimeStatus;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface EosProvisionLine {
  id: string;
  employeeId: string;
  employeeCode: string;
  serviceYears: number | string;
  monthlyWage: number | string;
  liability: number | string;
  booked: number | string;
  delta: number | string;
}

export interface EosProvision {
  id: string;
  period: string;
  postingDate: string;
  status: 'posted' | 'reversed';
  employeeCount: number;
  totalLiability: number | string;
  totalDelta: number | string;
  createdAt: string;
  lines?: EosProvisionLine[];
}

export type SettlementReason = 'termination' | 'contract_end' | 'resignation' | 'resignation_article_87' | 'dismissal_article_80';
export const SETTLEMENT_REASONS: SettlementReason[] = ['termination', 'contract_end', 'resignation', 'resignation_article_87', 'dismissal_article_80'];

export interface FinalSettlement {
  id: string;
  settlementNumber: string;
  employeeId: string;
  terminationDate: string;
  reason: SettlementReason;
  status: 'draft' | 'posted' | 'paid' | 'cancelled';
  monthlyWage: number | string;
  serviceYears: number | string;
  gratuity: number | string;
  provisionUsed: number | string;
  leaveDays: number | string;
  leaveEncashment: number | string;
  lastSalary: number | string;
  otherAdditions: number | string;
  loanDeduction: number | string;
  otherDeductions: number | string;
  totalEarnings: number | string;
  net: number | string;
  details: Record<string, any> | null;
  postingDate: string | null;
  paidDate: string | null;
  paymentMethod: HrPaymentMethod | null;
  notes: string | null;
  createdAt: string;
}

export interface MyProfile {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  hireDate: string;
  branchId?: string | null;
  departmentId?: string | null;
  jobTitleId?: string | null;
  email?: string | null;
  phone?: string | null;
  bankName?: string | null;
  iban?: string | null;
  status: string;
}

export interface MyPayslipRow {
  runId: string;
  runNumber: string;
  period: string;
  status: string;
  gross: number;
  totalDeductions: number;
  net: number;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  source: 'manual' | 'import';
  notes?: string | null;
}

export interface AttendanceSummaryRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  trackAttendance: boolean;
  from: string;
  to: string;
  workingDays: number;
  presentDays: number;
  absenceDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  lateMinutes: number;
  workedHours: number;
  overtimeHours: number;
}

export interface ImportRow {
  employeeId?: string;
  employeeCode?: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  notes?: string;
}

export interface ImportResult {
  received: number;
  imported: number;
  failed: number;
  errors: { row: number; error: string }[];
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  isPaid: boolean;
  annualEntitlement: number | string;
  seniorEntitlement?: number | string | null;
  seniorAfterYears?: number | null;
  allowNegative: boolean;
  isActive: boolean;
  accrualMethod?: 'annual' | 'monthly';
  carryForward?: boolean;
  carryForwardMax?: number | string | null;
  carryForwardExpiryMonths?: number | null;
  allowHalfDay?: boolean;
  encashable?: boolean;
}

export type LeaveStatus = 'draft' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveRequest {
  id: string;
  requestNumber: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  days: number | string;
  reason?: string | null;
  status: LeaveStatus;
  decisionNote?: string | null;
  halfDay?: boolean;
  halfDayPeriod?: 'am' | 'pm' | null;
}

export interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  isPaid: boolean;
  year: number;
  entitlement: number;
  taken: number;
  pending: number;
  remaining: number;
}

export interface LeaveBalanceReport {
  year: number;
  rows: {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    employeeNameAr?: string | null;
    departmentId?: string | null;
    balances: LeaveBalance[];
  }[];
}

export type LoanStatus = 'draft' | 'disbursed' | 'settled' | 'cancelled';

export interface LoanInstallment {
  id: string;
  sequence: number;
  duePeriod: string;
  amount: number | string;
  paidAmount: number | string;
}

export interface EmployeeLoan {
  id: string;
  loanNumber: string;
  employeeId: string;
  type: 'loan' | 'advance';
  amount: number | string;
  installmentCount: number;
  startPeriod: string;
  repaidAmount: number | string;
  status: LoanStatus;
  disbursementDate?: string | null;
  paymentMethod?: HrPaymentMethod | null;
  notes?: string | null;
  installments?: LoanInstallment[];
}

export interface PayrollAdjustment {
  id: string;
  employeeId: string;
  period: string;
  kind: 'addition' | 'deduction';
  category: string;
  description: string;
  amount: number | string;
  taxable: boolean;
  payrollRunId?: string | null;
}

export type PayrollRunStatus = 'draft' | 'approved' | 'paid' | 'cancelled' | 'reversed';

export interface PayrollLine {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  payrollCountry: PayrollCountry;
  basic: number | string;
  allowancesTotal: number | string;
  overtimePay: number | string;
  additionsTotal: number | string;
  attendanceDeductions: number | string;
  gross: number | string;
  insurableWage: number | string;
  employeeSi: number | string;
  employerSi: number | string;
  incomeTax: number | string;
  loanDeduction: number | string;
  otherDeductions: number | string;
  totalDeductions: number | string;
  net: number | string;
  details: Record<string, any>;
}

export interface PayrollRun {
  id: string;
  runNumber: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  branchId?: string | null;
  departmentId?: string | null;
  status: PayrollRunStatus;
  employeeCount: number;
  totalGross: number | string;
  totalEmployeeSi: number | string;
  totalEmployerSi: number | string;
  totalTax: number | string;
  totalLoans: number | string;
  totalOtherDeductions: number | string;
  totalNet: number | string;
  computedAt?: string | null;
  approvedAt?: string | null;
  postingDate?: string | null;
  paidDate?: string | null;
  paymentMethod?: HrPaymentMethod | null;
  notes?: string | null;
  lines?: PayrollLine[];
}

export type PayslipSummaryKey =
  | 'basic' | 'allowances' | 'overtime' | 'additions' | 'attendanceDeductions' | 'gross'
  | 'employeeSocialInsurance' | 'employerSocialInsurance' | 'incomeTax' | 'loans'
  | 'otherDeductions' | 'totalDeductions' | 'net';

export interface Payslip {
  run: { id: string; runNumber: string; period: string; periodStart: string; periodEnd: string; status: PayrollRunStatus };
  employee: {
    id: string;
    code: string;
    nameEn: string;
    nameAr?: string | null;
    nationalId?: string | null;
    nationality?: string | null;
    departmentId?: string | null;
    jobTitleId?: string | null;
    bankName?: string | null;
    iban?: string | null;
    socialInsuranceNumber?: string | null;
    payrollCountry: PayrollCountry;
  };
  summary: Record<PayslipSummaryKey, number>;
  breakdown: Record<string, any>;
}

export const REGISTER_KEYS = [
  'basic', 'allowances', 'overtime', 'additions', 'attendanceDeductions', 'gross',
  'employeeSi', 'employerSi', 'incomeTax', 'loans', 'otherDeductions', 'net',
] as const;
export type RegisterKey = (typeof REGISTER_KEYS)[number];

export type RegisterLine = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  payrollCountry: PayrollCountry;
} & Record<RegisterKey, number>;

export interface PayrollRegister {
  run: PayrollRun;
  lines: Omit<RegisterLine, 'id'>[];
  totals: Record<RegisterKey, number>;
}

export interface SocialInsuranceRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  nationalId: string | null;
  nationality: string | null;
  socialInsuranceNumber: string | null;
  payrollCountry: PayrollCountry;
  insurableWage: number;
  employeeShare: number;
  employerShare: number;
  total: number;
}

export interface SocialInsuranceReport {
  period: string;
  runs: string[];
  rows: SocialInsuranceRow[];
  totals: { country: PayrollCountry; employees: number; insurableWage: number; employeeShare: number; employerShare: number; total: number }[];
}

export const GRATUITY_REASONS = [
  'termination', 'contract_end', 'resignation', 'resignation_article_87', 'dismissal_article_80',
] as const;
export type GratuityReason = (typeof GRATUITY_REASONS)[number];

export interface GratuityResult {
  employeeId: string | null;
  reason: GratuityReason;
  startDate: string;
  endDate: string;
  country: PayrollCountry;
  serviceDays: number;
  serviceYears: number;
  monthlyWage: number;
  firstFiveYearsAward: number;
  afterFiveYearsAward: number;
  fullAward: number;
  entitlementFactor: number;
  amount: number;
  statutory: boolean;
  notes: string[];
}

export interface TaxBracket {
  upTo: number | null;
  rate: number;
}

export interface PayrollRules {
  general: { daysPerMonth: number; absenceDeductionMultiplier: number; lateDeductionMultiplier: number };
  EG: {
    siEmployeeRate: number;
    siEmployerRate: number;
    minInsurableWage: number;
    maxInsurableWage: number;
    personalExemption: number;
    taxBrackets: TaxBracket[];
    highIncomeTiers: { above: number; startBracket: number }[];
    overtimeMultiplier: number;
  };
  SA: {
    gosiSaudiEmployeeRate: number;
    gosiSaudiEmployerRate: number;
    gosiNonSaudiEmployeeRate: number;
    gosiNonSaudiEmployerRate: number;
    minContributoryWage: number;
    maxContributoryWage: number;
    contributoryAllowanceCodes: string[];
    overtimeMultiplier: number;
  };
}

export interface HrSettings {
  overrides: Record<string, any>;
  effective: PayrollRules;
}

export const clean = (params: Record<string, any> = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export const hrService = {
  // organisation
  departments: () => data<Department[]>(api.get('/hr/departments')),
  createDepartment: (body: Record<string, any>) => data<Department>(api.post('/hr/departments', body)),
  updateDepartment: (id: string, body: Record<string, any>) => data<Department>(api.patch(`/hr/departments/${id}`, body)),
  jobTitles: () => data<JobTitle[]>(api.get('/hr/job-titles')),
  createJobTitle: (body: Record<string, any>) => data<JobTitle>(api.post('/hr/job-titles', body)),
  updateJobTitle: (id: string, body: Record<string, any>) => data<JobTitle>(api.patch(`/hr/job-titles/${id}`, body)),
  schedules: () => data<WorkSchedule[]>(api.get('/hr/work-schedules')),
  createSchedule: (body: Record<string, any>) => data<WorkSchedule>(api.post('/hr/work-schedules', body)),
  updateSchedule: (id: string, body: Record<string, any>) => data<WorkSchedule>(api.patch(`/hr/work-schedules/${id}`, body)),
  holidays: (year?: number) => data<PublicHoliday[]>(api.get('/hr/holidays', { params: clean({ year }) })),
  createHoliday: (body: Record<string, any>) => data<PublicHoliday>(api.post('/hr/holidays', body)),
  deleteHoliday: (id: string) => data(api.delete(`/hr/holidays/${id}`)),
  settings: () => data<HrSettings>(api.get('/hr/settings')),
  updateSettings: (rules: Record<string, any>) => data<HrSettings>(api.put('/hr/settings', { rules })),
  gratuity: (body: Record<string, any>) => data<GratuityResult>(api.post('/hr/gratuity', clean(body))),

  // employees
  employees: (params: { status?: string; branchId?: string; departmentId?: string; search?: string } = {}) =>
    data<Employee[]>(api.get('/hr/employees', { params: clean(params) })),
  employee: (id: string) => data<Employee>(api.get(`/hr/employees/${id}`)),
  createEmployee: (body: Record<string, any>) => data<Employee>(api.post('/hr/employees', body)),
  updateEmployee: (id: string, body: Record<string, any>) => data<Employee>(api.patch(`/hr/employees/${id}`, body)),
  terminateEmployee: (id: string, body: { terminationDate: string; terminationReason: string }) =>
    data<Employee>(api.post(`/hr/employees/${id}/terminate`, body)),

  // attendance
  attendance: (params: { from: string; to: string; employeeId?: string }) =>
    data<AttendanceRecord[]>(api.get('/hr/attendance', { params: clean(params) })),
  attendanceSummary: (params: { from: string; to: string; employeeId?: string; branchId?: string; departmentId?: string }) =>
    data<AttendanceSummaryRow[]>(api.get('/hr/attendance/summary', { params: clean(params) })),
  upsertAttendance: (body: { employeeId: string; date: string; checkIn?: string; checkOut?: string; notes?: string }) =>
    data<AttendanceRecord>(api.post('/hr/attendance', clean(body))),
  importAttendance: (records: ImportRow[]) => data<ImportResult>(api.post('/hr/attendance/import', { records })),
  deleteAttendance: (id: string) => data(api.delete(`/hr/attendance/${id}`)),

  // leaves
  leaveTypes: () => data<LeaveType[]>(api.get('/hr/leave-types')),
  createLeaveType: (body: Record<string, any>) => data<LeaveType>(api.post('/hr/leave-types', body)),
  updateLeaveType: (id: string, body: Record<string, any>) => data<LeaveType>(api.patch(`/hr/leave-types/${id}`, body)),
  leaveRequests: (params: { employeeId?: string; status?: string } = {}) =>
    data<LeaveRequest[]>(api.get('/hr/leave-requests', { params: clean(params) })),
  createLeaveRequest: (body: Record<string, any>) => data<LeaveRequest>(api.post('/hr/leave-requests', clean(body))),
  approveLeave: (id: string, note?: string) => data<LeaveRequest>(api.post(`/hr/leave-requests/${id}/approve`, clean({ note }))),
  rejectLeave: (id: string, note?: string) => data<LeaveRequest>(api.post(`/hr/leave-requests/${id}/reject`, clean({ note }))),
  cancelLeave: (id: string) => data<LeaveRequest>(api.post(`/hr/leave-requests/${id}/cancel`)),
  employeeBalances: (employeeId: string, year: number) =>
    data<LeaveBalance[]>(api.get(`/hr/employees/${employeeId}/leave-balances`, { params: { year } })),
  balancesReport: (year: number) => data<LeaveBalanceReport>(api.get('/hr/reports/leave-balances', { params: { year } })),

  // loans
  loans: (params: { employeeId?: string; status?: string } = {}) =>
    data<EmployeeLoan[]>(api.get('/hr/loans', { params: clean(params) })),
  loan: (id: string) => data<EmployeeLoan>(api.get(`/hr/loans/${id}`)),
  createLoan: (body: Record<string, any>) => data<EmployeeLoan>(api.post('/hr/loans', clean(body))),
  disburseLoan: (id: string, body: { date: string; paymentMethod: HrPaymentMethod; treasuryId?: string }) =>
    data<EmployeeLoan>(api.post(`/hr/loans/${id}/disburse`, body)),
  cancelLoan: (id: string) => data<EmployeeLoan>(api.post(`/hr/loans/${id}/cancel`)),

  // payroll
  adjustments: (params: { period?: string; employeeId?: string } = {}) =>
    data<PayrollAdjustment[]>(api.get('/hr/payroll-adjustments', { params: clean(params) })),
  createAdjustment: (body: Record<string, any>) => data<PayrollAdjustment>(api.post('/hr/payroll-adjustments', clean(body))),
  deleteAdjustment: (id: string) => data(api.delete(`/hr/payroll-adjustments/${id}`)),
  runs: (params: { period?: string; status?: string } = {}) =>
    data<PayrollRun[]>(api.get('/hr/payroll-runs', { params: clean(params) })),
  run: (id: string) => data<PayrollRun>(api.get(`/hr/payroll-runs/${id}`)),
  createRun: (body: Record<string, any>) => data<PayrollRun>(api.post('/hr/payroll-runs', clean(body))),
  recomputeRun: (id: string) => data<PayrollRun>(api.post(`/hr/payroll-runs/${id}/recompute`)),
  approveRun: (id: string, postingDate?: string) =>
    data<PayrollRun>(api.post(`/hr/payroll-runs/${id}/approve`, clean({ postingDate }))),
  payRun: (id: string, body: { date: string; paymentMethod: HrPaymentMethod; treasuryId?: string }) =>
    data<PayrollRun>(api.post(`/hr/payroll-runs/${id}/pay`, body)),
  cancelRun: (id: string) => data<PayrollRun>(api.post(`/hr/payroll-runs/${id}/cancel`)),
  reverseRun: (id: string, date?: string) => data<PayrollRun>(api.post(`/hr/payroll-runs/${id}/reverse`, clean({ date }))),
  payslip: (runId: string, employeeId: string) => data<Payslip>(api.get(`/hr/payroll-runs/${runId}/payslips/${employeeId}`)),
  register: (runId: string) => data<PayrollRegister>(api.get(`/hr/payroll-runs/${runId}/register`)),
  socialInsurance: (period: string) => data<SocialInsuranceReport>(api.get('/hr/reports/social-insurance', { params: { period } })),

  // leave encashment
  encashments: (params: { employeeId?: string; period?: string } = {}) =>
    data<LeaveEncashment[]>(api.get('/hr/leave-encashments', { params: clean(params) })),
  createEncashment: (body: Record<string, any>) => data<LeaveEncashment>(api.post('/hr/leave-encashments', clean(body))),
  cancelEncashment: (id: string) => data<LeaveEncashment>(api.post(`/hr/leave-encashments/${id}/cancel`)),

  // overtime
  overtime: (params: { employeeId?: string; status?: string; from?: string; to?: string } = {}) =>
    data<OvertimeRequest[]>(api.get('/hr/overtime-requests', { params: clean(params) })),
  createOvertime: (body: Record<string, any>) => data<OvertimeRequest>(api.post('/hr/overtime-requests', clean(body))),
  approveOvertime: (id: string, note?: string) => data<OvertimeRequest>(api.post(`/hr/overtime-requests/${id}/approve`, clean({ note }))),
  rejectOvertime: (id: string, note?: string) => data<OvertimeRequest>(api.post(`/hr/overtime-requests/${id}/reject`, clean({ note }))),
  cancelOvertime: (id: string) => data<OvertimeRequest>(api.post(`/hr/overtime-requests/${id}/cancel`)),

  // end of service
  provisions: () => data<EosProvision[]>(api.get('/hr/eos-provisions')),
  provision: (id: string) => data<EosProvision>(api.get(`/hr/eos-provisions/${id}`)),
  createProvision: (body: { period: string; postingDate?: string }) => data<EosProvision>(api.post('/hr/eos-provisions', clean(body))),
  reverseProvision: (id: string, date?: string) => data<EosProvision>(api.post(`/hr/eos-provisions/${id}/reverse`, clean({ date }))),
  settlements: (params: { employeeId?: string; status?: string } = {}) =>
    data<FinalSettlement[]>(api.get('/hr/final-settlements', { params: clean(params) })),
  settlement: (id: string) => data<FinalSettlement>(api.get(`/hr/final-settlements/${id}`)),
  createSettlement: (body: Record<string, any>) => data<FinalSettlement>(api.post('/hr/final-settlements', body)),
  postSettlement: (id: string, date?: string) => data<FinalSettlement>(api.post(`/hr/final-settlements/${id}/post`, clean({ date }))),
  paySettlement: (id: string, body: { date: string; paymentMethod: HrPaymentMethod; treasuryId?: string }) =>
    data<FinalSettlement>(api.post(`/hr/final-settlements/${id}/pay`, clean(body))),
  cancelSettlement: (id: string, date?: string) => data<FinalSettlement>(api.post(`/hr/final-settlements/${id}/cancel`, clean({ date }))),
};

/** Employee self-service (/hr/me): open to every logged-in user linked to an employee. */
export const selfService = {
  profile: () => data<MyProfile>(api.get('/hr/me')),
  payslips: () => data<MyPayslipRow[]>(api.get('/hr/me/payslips')),
  payslip: (runId: string) => data<Payslip>(api.get(`/hr/me/payslips/${runId}`)),
  balances: (year?: number) => data<LeaveBalance[]>(api.get('/hr/me/leave-balances', { params: clean({ year }) })),
  leaveTypes: () => data<LeaveType[]>(api.get('/hr/me/leave-types')),
  leaveRequests: () => data<LeaveRequest[]>(api.get('/hr/me/leave-requests')),
  requestLeave: (body: Record<string, any>) => data<LeaveRequest>(api.post('/hr/me/leave-requests', clean(body))),
  cancelLeave: (id: string) => data<LeaveRequest>(api.post(`/hr/me/leave-requests/${id}/cancel`)),
  loans: () => data<EmployeeLoan[]>(api.get('/hr/me/loans')),
  overtime: () => data<OvertimeRequest[]>(api.get('/hr/me/overtime-requests')),
  requestOvertime: (body: { date: string; hours: number; reason?: string }) =>
    data<OvertimeRequest>(api.post('/hr/me/overtime-requests', clean(body))),
};
