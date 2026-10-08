import { amountInWords } from '../engine/number-to-words';
import { Field, PrintDocument } from '../templates/document.model';
import { dateTime, money } from '../templates/format';
import { labels, LabelKey, valueLabel } from '../templates/labels';
import { col, compact, otherLang } from './common';
import { computeRows, vatBreakdown } from './commercial.builder';
import { PayrollRegisterView, PayslipView, PosReceiptView, PrintContext } from './views';

/** POS receipt (80mm by default) with the ZATCA / ETA e-receipt QR when available. */
export function buildPosReceipt(v: PosReceiptView, ctx: PrintContext): PrintDocument {
  const t = labels(ctx.lang);
  const titleKey: LabelKey = v.refund ? 'posRefund' : v.saudi ? 'simplifiedTaxInvoice' : 'posReceipt';
  const rows = computeRows(v.lines, false);
  const vat = vatBreakdown(rows).filter((r) => r.rate > 0);
  const totals: Field[] = [{ label: t('subtotal'), value: money(v.subtotal) }];
  if (Number(v.discount) > 0) totals.push({ label: t('totalDiscount'), value: money(v.discount) });
  for (const r of vat) totals.push({ label: `${t('vatAt')} ${r.rate}%`, value: money(r.tax) });
  if (!vat.length) totals.push({ label: t('totalVat'), value: money(v.taxAmount) });
  totals.push({ label: `${t('grandTotal')} (${ctx.currencyCode})`, value: money(v.totalAmount), bold: true });
  if (!v.refund && Number(v.cashReceived) > 0) {
    totals.push({ label: t('cashReceived'), value: money(v.cashReceived), bold: false });
    totals.push({ label: t('change'), value: money(v.changeAmount ?? 0), bold: false });
  }
  return {
    lang: ctx.lang,
    paper: ctx.paper,
    title: t(titleKey),
    subtitle: otherLang(titleKey, ctx.lang),
    number: v.number,
    company: ctx.company,
    meta: compact([
      { label: t('date'), value: dateTime(v.date) },
      { label: ctx.lang === 'ar' ? 'نقطة البيع' : 'Terminal', value: v.terminalName },
      { label: t('cashier'), value: v.cashierName },
      { label: t('method'), value: valueLabel(v.paymentMethod, ctx.lang) },
      { label: t('status'), value: v.status === 'completed' ? null : valueLabel(v.status, ctx.lang) },
    ]),
    parties: v.customer
      ? [
          {
            title: t('customer'),
            fields: compact([
              { label: '', value: v.customer.name },
              { label: t('vatNumber'), value: v.customer.taxId },
            ]),
          },
        ]
      : [],
    tables: [
      {
        columns: [
          col('index', t('index'), 3, 'index', 'center'),
          col('item', t('item'), 30),
          col('quantity', t('quantity'), 8, 'qty'),
          col('unitPrice', t('unitPrice'), 10, 'money'),
          col('total', t('lineTotal'), 11, 'money'),
        ],
        rows: rows.map((r) => ({ ...r })),
        compact: { title: 'item', detail: ['quantity', 'unitPrice'], amount: 'total' },
      },
    ],
    totals,
    amountInWords: amountInWords(Number(v.totalAmount), ctx.currencyCode, ctx.lang),
    qr: v.qr ? { content: v.qr, caption: v.saudi ? t('zatcaQr') : t('etaQr') } : undefined,
    references: compact([{ label: 'UUID', value: v.eReceiptUuid }]),
    filename: `receipt-${v.number}`,
  };
}

/** Payslip of one employee in a payroll run. */
export function buildPayslip(v: PayslipView, ctx: PrintContext): PrintDocument {
  const t = labels(ctx.lang);
  const earnings: { item: string; amount: number }[] = [{ item: t('basic'), amount: v.basic }];
  if (v.allowances.length) {
    for (const a of v.allowances) earnings.push({ item: a.name, amount: a.amount });
  } else if (Number(v.allowancesTotal) > 0) {
    earnings.push({ item: t('allowances'), amount: v.allowancesTotal });
  }
  if (Number(v.overtimePay) > 0) earnings.push({ item: t('overtime'), amount: v.overtimePay });
  if (Number(v.additionsTotal) > 0) earnings.push({ item: t('additions'), amount: v.additionsTotal });

  const deductions: { item: string; amount: number }[] = [];
  const add = (key: LabelKey, amount: number) => Number(amount) > 0 && deductions.push({ item: t(key), amount });
  add('attendanceDeductions', v.attendanceDeductions);
  add('employeeSi', v.employeeSi);
  add('incomeTax', v.incomeTax);
  add('loans', v.loanDeduction);
  add('otherDeductions', v.otherDeductions);

  const table = (title: string, rows: { item: string; amount: number }[], total: number) => ({
    title,
    columns: [col('item', t('description'), 30), col('amount', t('amount'), 12, 'money' as const)],
    rows,
    footer: { item: t('grandTotal'), amount: total },
    compact: { title: 'item', amount: 'amount' },
  });

  return {
    lang: ctx.lang,
    paper: ctx.paper,
    title: t('payslip'),
    subtitle: otherLang('payslip', ctx.lang),
    number: v.period,
    company: ctx.company,
    meta: compact([
      { label: t('period'), value: v.period },
      { label: t('from'), value: v.periodStart },
      { label: t('to'), value: v.periodEnd },
      { label: t('reference'), value: v.runNumber },
      { label: t('status'), value: valueLabel(v.status, ctx.lang) },
    ]),
    parties: [
      {
        title: t('employee'),
        fields: compact([
          { label: t('name'), value: v.employee.name, bold: true },
          { label: t('code'), value: v.employee.code },
          { label: t('nationalId'), value: v.employee.nationalId },
          { label: ctx.lang === 'ar' ? 'القسم' : 'Department', value: v.employee.department },
          { label: ctx.lang === 'ar' ? 'الوظيفة' : 'Job title', value: v.employee.jobTitle },
          { label: ctx.lang === 'ar' ? 'تاريخ التعيين' : 'Hire date', value: v.employee.hireDate },
          { label: t('bank'), value: v.employee.bankName },
          { label: t('iban'), value: v.employee.iban },
        ]),
      },
    ],
    tables: [table(t('earnings'), earnings, v.gross), table(t('deductions'), deductions, v.totalDeductions)],
    totals: [
      { label: t('gross'), value: money(v.gross) },
      { label: t('totalDeductions'), value: money(v.totalDeductions) },
      { label: `${t('netPay')} (${ctx.currencyCode})`, value: money(v.net), bold: true },
    ],
    amountInWords: amountInWords(Number(v.net), ctx.currencyCode, ctx.lang),
    notes: Number(v.employerSi) > 0 ? [`${t('employerSi')}: ${money(v.employerSi)}`] : [],
    signatures: ctx.paper === '80mm' ? [] : [t('accountant'), t('employeeSign')],
    filename: `payslip-${v.employee.code}-${v.period}`,
  };
}

/** Payroll register (مسير الرواتب) of a run, landscape A4. */
export function buildPayrollRegister(v: PayrollRegisterView, ctx: PrintContext): PrintDocument {
  const t = labels(ctx.lang);
  const keys = [
    'basic',
    'allowancesTotal',
    'overtimePay',
    'additionsTotal',
    'gross',
    'attendanceDeductions',
    'employeeSi',
    'incomeTax',
    'loanDeduction',
    'otherDeductions',
    'totalDeductions',
    'net',
    'employerSi',
  ] as const;
  const footer: Record<string, unknown> = { employeeName: t('grandTotal') };
  for (const k of keys) footer[k] = v.lines.reduce((s, l) => s + Number(l[k] || 0), 0);
  const ar = ctx.lang === 'ar';
  return {
    lang: ctx.lang,
    paper: 'a4-landscape',
    title: t('payrollRegister'),
    subtitle: otherLang('payrollRegister', ctx.lang),
    number: v.runNumber,
    company: ctx.company,
    meta: compact([
      { label: t('period'), value: v.period },
      { label: t('from'), value: v.periodStart },
      { label: t('to'), value: v.periodEnd },
      { label: t('branch'), value: v.branchName },
      { label: ar ? 'القسم' : 'Department', value: v.departmentName },
      { label: t('employees'), value: v.lines.length },
      { label: t('status'), value: valueLabel(v.status, ctx.lang) },
    ]),
    tables: [
      {
        columns: [
          col('index', t('index'), 2.5, 'index', 'center'),
          col('employeeCode', t('code'), 5),
          col('employeeName', t('employee'), 14),
          col('basic', ar ? 'الأساسي' : 'Basic', 7, 'money'),
          col('allowancesTotal', t('allowances'), 7, 'money'),
          col('overtimePay', t('overtime'), 6, 'money'),
          col('additionsTotal', ar ? 'إضافات' : 'Additions', 6, 'money'),
          col('gross', ar ? 'الإجمالي' : 'Gross', 7.5, 'money'),
          col('attendanceDeductions', ar ? 'غياب وتأخير' : 'Absence', 6, 'money'),
          col('employeeSi', ar ? 'تأمينات' : 'Soc. ins.', 6.5, 'money'),
          col('incomeTax', ar ? 'ضريبة' : 'Tax', 6, 'money'),
          col('loanDeduction', ar ? 'سلف' : 'Loans', 6, 'money'),
          col('otherDeductions', ar ? 'خصومات' : 'Other ded.', 6, 'money'),
          col('totalDeductions', ar ? 'إجمالي الخصم' : 'Total ded.', 7, 'money'),
          col('net', ar ? 'الصافي' : 'Net', 7.5, 'money'),
          col('employerSi', ar ? 'تأمينات الشركة' : 'Employer SI', 7, 'money'),
        ],
        rows: v.lines.map((l) => ({ ...l })),
        footer,
      },
    ],
    totals: [
      { label: t('gross'), value: money(footer.gross) },
      { label: t('totalDeductions'), value: money(footer.totalDeductions) },
      { label: `${t('netPay')} (${ctx.currencyCode})`, value: money(footer.net), bold: true },
    ],
    amountInWords: amountInWords(Number(footer.net), ctx.currencyCode, ctx.lang),
    signatures: [t('preparedBy'), t('accountant'), t('approvedBy')],
    filename: `payroll-${v.runNumber}`,
  };
}
