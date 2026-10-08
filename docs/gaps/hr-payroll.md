# HR, attendance and payroll (Egypt / Saudi Arabia)

New module `erp-backend/src/modules/hr/` (`HrModule`). Permissions module `hr`, screens
`employees`, `attendance`, `leaves`, `loans`, `payroll` (actions `read`, `create`, `update`,
`delete`, `approve`).

## What was built

- **Master data**: departments (tree, branch, manager), job titles, work schedules (daily hours,
  start time, weekend days, grace minutes, one tenant default), public holidays.
- **Employees**: code (auto `EMP-000001`), English/Arabic name, ID type (national ID / iqama /
  passport) and number, nationality (ISO-2), birth date, hire date, branch, department, job title,
  manager, schedule, bank name/account/IBAN, contract type and end date, status
  active/terminated (termination date and reason), basic salary, named fixed allowances
  (`[{code, name, amount}]`, `housing` counts towards the GOSI wage), contractual insurable wage,
  social insurance number and enrolment flag, payroll country `EG|SA`, attendance tracking flag,
  optional linked user.
- **Attendance**: daily check-in/out per employee (manual upsert and bulk JSON import matched by
  employee id or code, with per-row errors), per-period summary of working days, present days,
  absence days, paid/unpaid leave days, late minutes (beyond the grace period) and overtime hours
  (hours beyond the daily hours; all hours worked on weekends/holidays). Overnight shifts are
  supported. Absence, lateness and overtime are only computed for employees with
  `trackAttendance = true`; leaves always count.
- **Leaves**: leave types (paid flag, annual entitlement, senior entitlement after N years,
  allow-negative), requests draft -> approved/rejected (and cancel), days counted in working days
  (weekends and holidays excluded), overlap check, balance check on approval per calendar year,
  balances per employee/year (entitlement prorated for joiners, taken, pending, remaining).
  Approved unpaid leave days are deducted in payroll.
- **Loans and advances (سلف)**: draft -> disbursed (posting + monthly installment schedule) ->
  settled; cancel (draft, or disbursed with nothing recovered: the posting is reversed).
  Payroll deducts outstanding installments due up to the month, oldest first, only up to the
  available net pay (the rest stays outstanding).
- **Payroll adjustments**: one-off additions (bonus, commission...) and deductions (penalty...)
  per employee and month; additions can be flagged non-taxable (Egypt).
- **Payroll runs** per month, optionally per branch/department; an employee can be in only one
  active run per month. Draft (computed, recompute, adjustments editable) -> approved (recomputed,
  accrual posted, adjustments locked, loan installments recovered) -> paid; cancel draft; reverse
  approved/paid (journal reversals, installments restored, adjustments freed).
- **Calculator** (`calculators/payroll-calculator.ts`, pure and unit-tested) with configuration
  (`calculators/payroll-rules.ts`) overridable per tenant through `PUT /hr/settings`.
- **Reports**: payroll register per run, social insurance / GOSI report per month, leave balances
  per year; payslip per employee with the full breakdown.
- **End-of-service gratuity** endpoint.

## Endpoints (`/api/v1`)

| Area | Endpoints |
| --- | --- |
| Setup | `GET/POST /hr/departments`, `PATCH /hr/departments/:id`, `GET/POST /hr/job-titles`, `PATCH /hr/job-titles/:id`, `GET/POST /hr/work-schedules`, `PATCH /hr/work-schedules/:id`, `GET/POST /hr/holidays`, `DELETE /hr/holidays/:id`, `GET/PUT /hr/settings` |
| Employees | `GET/POST /hr/employees`, `GET/PATCH /hr/employees/:id`, `POST /hr/employees/:id/terminate`, `POST /hr/gratuity` |
| Attendance | `GET /hr/attendance?from&to[&employeeId]`, `POST /hr/attendance`, `POST /hr/attendance/import`, `DELETE /hr/attendance/:id`, `GET /hr/attendance/summary?from&to[&employeeId|branchId|departmentId]` |
| Leaves | `GET/POST /hr/leave-types`, `PATCH /hr/leave-types/:id`, `GET/POST /hr/leave-requests`, `GET /hr/leave-requests/:id`, `POST /hr/leave-requests/:id/approve|reject|cancel`, `GET /hr/employees/:id/leave-balances?year`, `GET /hr/reports/leave-balances?year` |
| Loans | `GET/POST /hr/loans`, `GET /hr/loans/:id`, `POST /hr/loans/:id/disburse`, `POST /hr/loans/:id/cancel` |
| Payroll | `GET/POST /hr/payroll-adjustments`, `DELETE /hr/payroll-adjustments/:id`, `GET/POST /hr/payroll-runs`, `GET /hr/payroll-runs/:id`, `POST /hr/payroll-runs/:id/recompute|approve|pay|cancel|reverse`, `GET /hr/payroll-runs/:id/payslips/:employeeId`, `GET /hr/payroll-runs/:id/register`, `GET /hr/reports/social-insurance?period=YYYY-MM` |

## Schema additions

Tables `hr_departments`, `hr_job_titles`, `hr_work_schedules`, `hr_public_holidays`,
`hr_employees`, `hr_attendance_records`, `hr_leave_types`, `hr_leave_requests`,
`hr_employee_loans`, `hr_loan_installments`, `hr_payroll_adjustments`, `hr_payroll_runs`,
`hr_payroll_lines` (with a `details` jsonb breakdown), `hr_settings` (jsonb rule overrides).
Sequences: `employee` (EMP), `leave_request` (LV), `employee_loan` (LOAN), `payroll_run` (PAY).
No change to `accounting_settings`.

## Posting rules

| Event | Journal | Lines |
| --- | --- | --- |
| Loan disbursement (`employee_loan`) | cash/bank | Dr employeeAdvances / Cr cash or bank |
| Payroll approval (`payroll_run`), per branch | general | Dr salariesExpense (gross), Dr socialInsuranceExpense (employer share) / Cr socialInsurancePayable (employee + employer), Cr payrollTaxPayable, Cr employeeAdvances (installments), Cr salariesExpense (one-off deductions such as penalties), Cr salariesPayable (net) |
| Payroll payment (`payroll_payment`) | cash/bank | Dr salariesPayable / Cr cash or bank (total net) |
| Run reversal / loan cancellation | | reversal of the entries above |

The accrual is dated on the last day of the month unless `postingDate` is given. All accounts are
preflighted (and the period must be open) before anything is changed.

## Payroll computation

Per employee and month:

- Fixed pay = basic + allowances, prorated by calendar days employed (joiners/leavers).
- Daily wage = (basic + allowances) / `general.daysPerMonth` (30); hourly = daily / schedule hours.
- Overtime pay = hours x hourly x multiplier (EG 1.35, SA 1.5 — art. 107 is "hourly wage + 50% of
  basic hourly"; the simplified multiplier on the full hourly wage is configurable).
- Deductions from gross: absence days x daily x `absenceDeductionMultiplier`, unpaid leave days x
  daily, late minutes / 60 x hourly x `lateDeductionMultiplier` (gross never below zero).
- Gross = fixed pay + overtime + additions - attendance deductions.
- Employee deductions: social insurance, salary tax, loan installments, one-off deductions.

### Egypt

- Social insurance, Law 148/2019: employee 11%, employer 18.75% of the insurable wage clamped to
  the yearly min/max. Defaults: min 2,300 / max 14,500 EGP per month (2025 values; the limits are
  revised every January — update them in `PUT /hr/settings`, e.g.
  `{"rules":{"EG":{"minInsurableWage":...,"maxInsurableWage":...}}}`). The insurable wage is the
  employee's contractual `socialInsuranceWage`, or basic + allowances when not set; it is not
  prorated for partial months.
- Salary tax, Law 91/2005 as amended by Law 7/2024: annual brackets 0-40k 0%, 40-55k 10%,
  55-70k 15%, 70-200k 20%, 200-400k 22.5%, 400k-1.2M 25%, above 27.5%, after a 20,000 personal
  exemption. High-income bracket removal as published: annual taxable income above 600k loses
  the 0% bracket (first 55k at 10%), above 700k the first 70k are taxed at 15%, above 800k the
  first 200k at 20%, above 900k the first 400k at 22.5%, above 1.2M the first 1.2M at 25%.
  **Assumptions**: the tier is chosen on taxable income after the personal exemption; the tax is
  computed by annualisation of the month (taxable pay less the employee insurance share x 12,
  minus the exemption, tax / 12) with no year-to-date true-up, so variable pay (bonuses) is taxed
  as if recurring; non-taxable additions are excluded; no other exemptions (e.g. disability,
  Martyrs fund 0.05% contribution) are modelled.
- End-of-service gratuity is not statutory (benefits are paid by NOSI); the endpoint returns 0
  with a note.

### Saudi Arabia

- GOSI: Saudis employee 9.75% (annuities 9% + SANED 0.75%), employer 11.75% (incl. 2% occupational
  hazards); non-Saudis employer 2% only. Contributory wage = basic + allowances whose code is in
  `SA.contributoryAllowanceCodes` (default `housing`), or the contractual wage, clamped to
  1,500-45,000 SAR. Saudi status = nationality `SA`. The 2024 reform phasing in higher annuity
  rates for new entrants is not automated: override the rates in settings if needed. GCC
  nationals are treated as non-Saudis.
- No income tax.
- Gratuity, Labour Law art. 84: half a month per year for the first 5 years, one month per year
  after, fractions pro rata (years = days / 365); art. 85 resignation: <2 years none, 2-5 one third,
  5-10 two thirds, 10+ full; art. 87 resignation full; art. 80 dismissal none. Wage defaults to
  basic + all fixed allowances.

## Still missing

- Payslip PDF and payroll register PDF are done (see `printing.md`). Still missing: bank salary transfer files (WPS / Mudad for KSA, bank sheets for Egypt), GOSI and
  Form 2/6 (Egypt) official filings, monthly tax return (Form 4) export.
- Year-to-date tax true-up and an annual tax settlement for Egypt; Martyrs fund contribution.
- Leave carry-forward and encashment, half-day leaves, leave accrual per month, leave salary
  advance (KSA), approval workflows/delegation and employee self-service.
- Overtime approval, shift rotations, multiple schedules per employee, device integrations.
- Gratuity provision accrual (monthly EOSB provision posting) and final settlement document.
- Cancelling an approved leave whose month is already in an approved payroll is not blocked.
- Multi-currency payroll (runs are in the tenant base currency) and per-employee cost centres
  (postings are split by branch only).
