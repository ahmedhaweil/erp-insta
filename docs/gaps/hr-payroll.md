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

## Phase 2 additions

### Leaves

- **Accrual**: leave types have `accrualMethod` `annual` (full entitlement on 1 January, as before) or
  `monthly` (earned at each month end, pro rata to the days employed in the year). Approval checks the
  balance accrued by the end of the request.
- **Carry-forward**: `carryForward`, `carryForwardMax` (cap, empty = unlimited) and
  `carryForwardExpiryMonths` (carried days must be used within N months of the new year, e.g. 3 = by
  31 March). Leave taken before the expiry date consumes carried days first; unused carried days
  expire. Balances are rolled from the hire year by the pure `calculators/leave-calculator.ts`.
- **Half days**: `halfDay` + `halfDayPeriod` (am/pm) on a single-date request = 0.5 day (type flag
  `allowHalfDay`). Attendance counts 0.5 leave and expects the other half to be worked (tracked
  employees: 0.5 absence without a check-in; overtime beyond half the daily hours).
- **Encashment** (`encashable` types): `POST /hr/leave-encashments` checks the remaining balance of the
  year and creates a taxable payroll addition (category `leave_encashment`) for the chosen month at
  (basic + allowances) / `general.daysPerMonth` per day (or a given `dailyRate`). Encashed days
  reduce the balance. Cancel deletes the addition (refused once consumed by an approved run).
- **Payroll lock**: approving or cancelling an approved leave (and approving/cancelling overtime,
  creating encashments) is refused when one of its months is in an approved/paid payroll run of the
  employee (`PayrollLockService`).
- Balances return `entitlement`, `accrued`, `carriedIn`, `carriedExpired`, `carryExpiryDate`, `taken`,
  `pending`, `encashed`, `remaining`, `carryOut`; `GET /hr/employees/:id/leave-balances?year&asOf`.

### Overtime requests

`hr_overtime_requests` (draft -> approved / rejected, cancel). `general.overtimeMode` in the HR
rules: `auto` (default; tracked employees get the attendance overtime, untracked employees their
approved requests) or `approved_only` (only approved requests; for tracked employees each request is
capped at the overtime recorded by attendance that day). Pure logic in
`calculators/overtime-calculator.ts`; the resolution is stored in the payslip `details.overtime`.

### Egyptian tax: year-to-date true-up and Martyrs fund

- Egyptian payslips are now taxed cumulatively (`PayrollCalculator.egyptCumulativeTax`, still pure):
  recurring taxable pay is annualised over the months paid so far this year (A = regular YTD x 12 /
  n), one-off taxable additions (bonuses, encashments) are taxed at the marginal rate on top:
  `due YTD = tax(A - exemption) x n/12 + [tax(A + one-offs YTD - exemption) - tax(A - exemption)]`,
  month tax = due YTD - tax withheld in the earlier approved/paid runs of the year. With a constant
  salary this equals the old annualisation; the last month of the year trues up to the exact annual
  tax (a negative month tax is a refund, posted as a debit to payroll tax payable). Payslip details
  keep `incomeTax.regularTaxable/irregularTaxable/cumulative`.
- Martyrs fund (Law 4/2021): `EG.martyrsFund = { enabled (default false), rate (0.0005), bearer:
  employee|employer }`, on the gross. Employee-borne amounts are deducted from net
  (`hr_payroll_lines.martyrs_fund`), employer-borne are an extra salaries expense
  (`martyrs_fund_employer`). Credited to `hr_settings.martyrsFundAccountId` or payroll tax payable.

### End of service

- **Provision** `POST /hr/eos-provisions {period, postingDate?}` (one per month, in order): for each
  employee employed at the month end (or terminated and not yet settled) the gratuity liability at
  that date (termination basis, no resignation reduction) less the provision already booked
  (posted provision deltas - provision used by settlements) is posted per employee with branch and
  cost center: Dr EOS expense / Cr EOS provision (negative deltas released the other way). The
  accounts live in `hr_settings` (`eosExpenseAccountId`, `eosProvisionAccountId`, set with
  `PUT /hr/settings`) because the accounting-settings keys are fixed. The latest provision can be
  reversed.
- **Egypt**: `EG.contractualGratuityMonthsPerYear` (default 0) gives a contractual award of N months
  per service year; 0 keeps the statutory "none".
- **Final settlement** `POST /hr/final-settlements` for a terminated employee: gratuity for the
  reason (art. 84/85/87/80), encashment of the remaining balance of encashable paid leave types at
  the termination date, last salary (pro rata days of the termination month unless that month is in
  an approved payroll, or a given amount), other additions/deductions, minus the outstanding loan
  balance (capped at the earnings). Post: Dr EOS provision (booked provision) and Dr/Cr EOS expense
  for the difference (without EOS accounts the gratuity is expensed to salaries expense), Dr salaries
  expense (leave + last salary + additions) / Cr employee advances (loans, installments marked
  recovered), Cr salaries expense (other deductions), Cr salaries payable (net). Pay: Dr salaries
  payable / Cr cash|bank. Cancel reverses both entries and restores the loan installments.

### Payroll per cost center and bank files

- `hr_employees.cost_center_id`: copied on each payslip line and used on the expense lines of the
  accrual (salaries, employer insurance, deductions) and of EOS postings. The register adds
  `byCostCenter` totals.
- `GET /hr/payroll-runs/:id/bank-file?format=generic|wps&bankName&valueDate&download=true`
  (approved/paid runs): generic bank sheet (code, name, national ID, bank, account, IBAN, amount,
  reference, value date) or a Saudi WPS / Mudad-style file (employee number, name, ID, bank code from
  the IBAN, IBAN, basic, housing, other earnings, deductions, net, period, value date). IBANs are
  checked with mod-97; employees without IBAN/account are listed in `warnings`. JSON by default
  (with `content`), or a CSV download.

### Self-service

`/hr/me` endpoints need no HR permission and are scoped to the employee whose `userId` is the caller:
`GET /hr/me`, `GET /hr/me/payslips`, `GET /hr/me/payslips/:runId` (approved/paid only),
`GET /hr/me/leave-balances?year`, `GET /hr/me/leave-types`, `GET/POST /hr/me/leave-requests`,
`POST /hr/me/leave-requests/:id/cancel` (drafts only), `GET /hr/me/loans`,
`GET/POST /hr/me/overtime-requests`.

### New endpoints

| Area | Endpoints |
| --- | --- |
| Leaves | `GET/POST /hr/leave-encashments`, `POST /hr/leave-encashments/:id/cancel` |
| Overtime | `GET/POST /hr/overtime-requests`, `GET /hr/overtime-requests/:id`, `POST /hr/overtime-requests/:id/approve|reject|cancel` (screen `attendance`) |
| End of service | `GET/POST /hr/eos-provisions`, `GET /hr/eos-provisions/:id`, `POST /hr/eos-provisions/:id/reverse`, `GET/POST /hr/final-settlements`, `GET /hr/final-settlements/:id`, `POST /hr/final-settlements/:id/post|pay|cancel` (screen `payroll`) |
| Payroll | `GET /hr/payroll-runs/:id/bank-file` |
| Settings | `PUT /hr/settings` now also takes `eosExpenseAccountId`, `eosProvisionAccountId`, `martyrsFundAccountId`; `rules` is optional |
| Self-service | `/hr/me/...` (above) |

### Schema additions (phase 2)

New tables `hr_leave_encashments`, `hr_overtime_requests`, `hr_eos_provisions`,
`hr_eos_provision_lines`, `hr_final_settlements`. New columns: `hr_employees.cost_center_id`;
`hr_leave_types.accrual_method, carry_forward, carry_forward_max, carry_forward_expiry_months,
allow_half_day, encashable`; `hr_leave_requests.half_day, half_day_period`;
`hr_payroll_lines.cost_center_id, martyrs_fund, martyrs_fund_employer`; `hr_settings.eos_expense_account_id,
eos_provision_account_id, martyrs_fund_account_id`. Sequence `final_settlement` (FS).

### Posting rules (phase 2)

| Event | Lines |
| --- | --- |
| EOS provision (`eos_provision`) | per employee: Dr EOS expense (cost center) / Cr EOS provision for increases, reverse for decreases |
| Final settlement (`final_settlement`) | Dr EOS provision (booked), Dr/Cr EOS expense (gratuity - booked), Dr salaries expense (leave encashment + last salary + additions) / Cr employee advances, Cr salaries expense (other deductions), Cr salaries payable |
| Settlement payment (`final_settlement_payment`) | Dr salaries payable / Cr cash or bank |
| Payroll accrual changes | Martyrs fund Cr fund account (Dr salaries expense when employer-borne); negative tax (refund) Dr payroll tax payable; cost center on expense lines |

## Still missing

- Payslip and payroll register PDFs are done (see `printing.md`). Still missing: bank-specific fixed-width formats (the files are generic CSV; the real Mudad/WPS SIF
  upload layout varies by bank), GOSI and Form 2/6 (Egypt) official filings, monthly tax return
  (Form 4) and annual settlement form export.
- The final settlement's last salary is gross (no insurance/tax); run the last month's payroll
  instead when deductions matter. Leave encashment at termination uses the fixed wage, not the
  actual last wage with variable pay.
- Carry-forward expiry uses the first day of each request in a year (a request straddling the
  expiry date consumes carried days for its whole length).
- Leave salary advance (KSA), multi-level approval workflows/delegation, manager self-service
  (approving the team's requests), shift rotations, multiple schedules per employee, device
  integrations.
- EOS provision for Egypt is zero unless a contractual award is configured; the Saudi provision uses
  the termination basis (no resignation reduction) and the current fixed wage.
- Multi-currency payroll (runs are in the tenant base currency); payroll runs cannot be filtered by
  cost center (postings are split by cost center through the employee).
