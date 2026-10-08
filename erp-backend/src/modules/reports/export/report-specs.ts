import { ExportSpec, L } from './report-export.service';

/**
 * Excel layouts of the reports (columns and labels in Arabic and English).
 * Each function receives the JSON result of the matching report endpoint.
 */
const meta = (from?: string | null, to?: string | null) => [
  { label: L.from, value: from },
  { label: L.to, value: to },
];

export function trialBalanceSpec(d: any): ExportSpec {
  return {
    title: { en: 'Trial balance', ar: 'ميزان المراجعة' },
    filename: 'trial-balance',
    meta: meta(d.from, d.to),
    sheets: [
      {
        name: { en: 'Trial balance', ar: 'ميزان المراجعة' },
        columns: [
          { key: 'code', label: L.code, width: 12 },
          { key: 'name', label: L.account, width: 36 },
          { key: 'openingDebit', label: { en: 'Opening debit', ar: 'رصيد أول المدة مدين' }, type: 'money' },
          { key: 'openingCredit', label: { en: 'Opening credit', ar: 'رصيد أول المدة دائن' }, type: 'money' },
          { key: 'periodDebit', label: { en: 'Period debit', ar: 'حركة الفترة مدين' }, type: 'money' },
          { key: 'periodCredit', label: { en: 'Period credit', ar: 'حركة الفترة دائن' }, type: 'money' },
          { key: 'closingDebit', label: { en: 'Closing debit', ar: 'رصيد آخر المدة مدين' }, type: 'money' },
          { key: 'closingCredit', label: { en: 'Closing credit', ar: 'رصيد آخر المدة دائن' }, type: 'money' },
        ],
        rows: d.accounts.map((a: any) => ({
          ...a,
          code: a.code,
          name: `${'  '.repeat(a.level ?? 0)}${a.nameAr}${a.nameEn ? ` - ${a.nameEn}` : ''}`,
        })),
        totals: { name: L.total.en + ' / ' + L.total.ar, ...d.totals },
      },
    ],
  };
}

export function generalLedgerSpec(d: any): ExportSpec {
  return {
    title: { en: `Account statement ${d.account.code}`, ar: `كشف حساب ${d.account.code}` },
    filename: `account-statement-${d.account.code}`,
    meta: [
      { label: L.account, value: `${d.account.code} ${d.account.nameAr} ${d.account.nameEn ?? ''}` },
      ...meta(d.from, d.to),
      { label: { en: 'Opening balance', ar: 'الرصيد الافتتاحي' }, value: d.openingBalance },
    ],
    sheets: [
      {
        name: { en: 'Ledger', ar: 'دفتر الأستاذ' },
        columns: [
          { key: 'date', label: L.date, type: 'date' },
          { key: 'refNumber', label: { en: 'Entry', ar: 'رقم القيد' }, width: 16 },
          { key: 'journal', label: { en: 'Journal', ar: 'اليومية' }, width: 16 },
          { key: 'accountCode', label: L.code, width: 10 },
          { key: 'description', label: L.description, width: 40 },
          { key: 'costCenterCode', label: { en: 'Cost center', ar: 'مركز التكلفة' }, width: 12 },
          { key: 'debit', label: L.debit, type: 'money' },
          { key: 'credit', label: L.credit, type: 'money' },
          { key: 'balance', label: L.balance, type: 'money' },
        ],
        rows: [
          { description: 'Opening balance / رصيد أول المدة', balance: d.openingBalance },
          ...d.entries,
        ],
        totals: { description: 'Total / الإجمالي', debit: d.totalDebit, credit: d.totalCredit, balance: d.closingBalance },
      },
    ],
  };
}

export function profitLossSpec(d: any, from?: string, to?: string): ExportSpec {
  const cols = [
    { key: 'code', label: L.code, width: 12 },
    { key: 'name', label: L.account, width: 40 },
    { key: 'amount', label: { en: 'Amount', ar: 'المبلغ' }, type: 'money' as const },
  ];
  const map = (rows: any[], sign: number) =>
    rows.map((a) => ({ code: a.code, name: `${a.nameAr} - ${a.nameEn ?? ''}`, amount: sign * a.balance }));
  return {
    title: { en: 'Profit and loss', ar: 'قائمة الدخل' },
    filename: 'profit-and-loss',
    meta: [...meta(from, to), { label: { en: 'Net income', ar: 'صافي الربح' }, value: d.netIncome }],
    sheets: [
      { name: { en: 'Revenue', ar: 'الإيرادات' }, columns: cols, rows: map(d.revenue, -1), totals: { name: 'Total / الإجمالي', amount: d.totalRevenue } },
      { name: { en: 'Expenses', ar: 'المصروفات' }, columns: cols, rows: map(d.expenses, 1), totals: { name: 'Total / الإجمالي', amount: d.totalExpenses } },
    ],
  };
}

export function balanceSheetSpec(d: any, asOf?: string): ExportSpec {
  const cols = [
    { key: 'code', label: L.code, width: 12 },
    { key: 'name', label: L.account, width: 40 },
    { key: 'amount', label: { en: 'Amount', ar: 'المبلغ' }, type: 'money' as const },
  ];
  const map = (rows: any[], sign: number) =>
    rows.map((a) => ({ code: a.code, name: `${a.nameAr} - ${a.nameEn ?? ''}`, amount: sign * a.balance }));
  return {
    title: { en: 'Balance sheet', ar: 'الميزانية العمومية' },
    filename: 'balance-sheet',
    meta: [{ label: { en: 'As of', ar: 'في' }, value: asOf }],
    sheets: [
      { name: { en: 'Assets', ar: 'الأصول' }, columns: cols, rows: map(d.assets, 1), totals: { name: 'Total / الإجمالي', amount: d.totalAssets } },
      {
        name: { en: 'Liabilities and equity', ar: 'الالتزامات وحقوق الملكية' },
        columns: cols,
        rows: [
          ...map(d.liabilities, -1),
          ...map(d.equity, -1),
          { name: 'Current year earnings / أرباح العام الجاري', amount: d.currentEarnings },
        ],
        totals: { name: 'Total / الإجمالي', amount: d.totalLiabilitiesAndEquity },
      },
    ],
  };
}

export function agedSpec(d: any, payable: boolean): ExportSpec {
  return {
    title: payable
      ? { en: 'Aged payables', ar: 'أعمار أرصدة الموردين' }
      : { en: 'Aged receivables', ar: 'أعمار أرصدة العملاء' },
    filename: payable ? 'aged-payables' : 'aged-receivables',
    meta: [{ label: { en: 'As of', ar: 'في' }, value: d.asOf }],
    sheets: [
      {
        name: { en: 'Aged balances', ar: 'أعمار الأرصدة' },
        columns: [
          { key: 'partnerName', label: L.name, width: 32 },
          { key: 'current', label: { en: 'Not due', ar: 'غير مستحق' }, type: 'money' },
          { key: 'b1', label: { en: '1-30', ar: '1-30 يوم' }, type: 'money' },
          { key: 'b2', label: { en: '31-60', ar: '31-60 يوم' }, type: 'money' },
          { key: 'b3', label: { en: '61-90', ar: '61-90 يوم' }, type: 'money' },
          { key: 'b4', label: { en: 'Over 90', ar: 'أكثر من 90 يوم' }, type: 'money' },
          { key: 'total', label: L.total, type: 'money' },
        ],
        rows: d.partners.map((p: any) => ({
          partnerName: p.partnerName,
          current: p.buckets.current,
          b1: p.buckets['1-30'],
          b2: p.buckets['31-60'],
          b3: p.buckets['61-90'],
          b4: p.buckets['90+'],
          total: p.total,
        })),
        totals: {
          partnerName: 'Total / الإجمالي',
          current: d.totals.current,
          b1: d.totals['1-30'],
          b2: d.totals['31-60'],
          b3: d.totals['61-90'],
          b4: d.totals['90+'],
          total: d.total,
        },
      },
    ],
  };
}

export function budgetSpec(d: any): ExportSpec {
  return {
    title: { en: 'Budget vs actual', ar: 'الموازنة مقابل الفعلي' },
    filename: 'budget-vs-actual',
    meta: [{ label: { en: 'Fiscal year', ar: 'السنة المالية' }, value: d.fiscalYear?.name }],
    sheets: [
      {
        name: { en: 'Budget', ar: 'الموازنة' },
        columns: [
          { key: 'accountCode', label: L.code, width: 12 },
          { key: 'accountName', label: L.account, width: 36 },
          { key: 'planned', label: { en: 'Planned', ar: 'المخطط' }, type: 'money' },
          { key: 'actual', label: { en: 'Actual', ar: 'الفعلي' }, type: 'money' },
          { key: 'variance', label: { en: 'Variance', ar: 'الانحراف' }, type: 'money' },
          { key: 'achievement', label: { en: 'Achievement %', ar: 'نسبة التحقيق %' }, type: 'percent' },
        ],
        rows: d.lines,
      },
    ],
  };
}

export function partnerStatementSpec(d: any): ExportSpec {
  const isCustomer = d.partnerType === 'customer';
  return {
    title: isCustomer
      ? { en: 'Customer statement of account', ar: 'كشف حساب عميل' }
      : { en: 'Supplier statement of account', ar: 'كشف حساب مورد' },
    filename: `statement-${d.partner.code}`,
    meta: [
      { label: L.name, value: `${d.partner.code} - ${d.partner.nameAr} / ${d.partner.nameEn ?? ''}` },
      { label: { en: 'Tax ID', ar: 'الرقم الضريبي' }, value: d.partner.taxId },
      ...meta(d.from, d.to),
    ],
    sheets: [
      {
        name: { en: 'Statement', ar: 'كشف الحساب' },
        columns: [
          { key: 'date', label: L.date, type: 'date' },
          { key: 'documentType', label: { en: 'Type', ar: 'النوع' }, width: 14 },
          { key: 'number', label: { en: 'Number', ar: 'الرقم' }, width: 18 },
          { key: 'reference', label: L.reference, width: 16 },
          { key: 'description', label: L.description, width: 36 },
          { key: 'dueDate', label: { en: 'Due date', ar: 'تاريخ الاستحقاق' }, type: 'date' },
          { key: 'debit', label: L.debit, type: 'money' },
          { key: 'credit', label: L.credit, type: 'money' },
          { key: 'balance', label: L.balance, type: 'money' },
        ],
        rows: [{ description: 'Opening balance / رصيد أول المدة', balance: d.openingBalance }, ...d.lines],
        totals: { description: 'Total / الإجمالي', debit: d.totalDebit, credit: d.totalCredit, balance: d.closingBalance },
      },
    ],
  };
}

export function dimensionPnlSpec(d: any): ExportSpec {
  const isBranch = d.dimension === 'branch';
  return {
    title: isBranch
      ? { en: 'Profit and loss by branch', ar: 'قائمة الدخل حسب الفرع' }
      : { en: 'Profit and loss by cost center', ar: 'قائمة الدخل حسب مركز التكلفة' },
    filename: isBranch ? 'branch-pnl' : 'cost-center-pnl',
    meta: meta(d.from, d.to),
    sheets: [
      {
        name: { en: 'Summary', ar: 'ملخص' },
        columns: [
          { key: 'code', label: L.code, width: 12 },
          { key: 'name', label: L.name, width: 30 },
          { key: 'revenue', label: { en: 'Revenue', ar: 'الإيرادات' }, type: 'money' },
          { key: 'expenses', label: { en: 'Expenses', ar: 'المصروفات' }, type: 'money' },
          { key: 'netProfit', label: { en: 'Net profit', ar: 'صافي الربح' }, type: 'money' },
          { key: 'margin', label: L.margin, type: 'percent' },
        ],
        rows: d.groups,
        totals: { name: 'Total / الإجمالي', revenue: d.totalRevenue, expenses: d.totalExpenses, netProfit: d.netProfit },
      },
      {
        name: { en: 'Details', ar: 'التفاصيل' },
        columns: [
          { key: 'group', label: { en: isBranch ? 'Branch' : 'Cost center', ar: isBranch ? 'الفرع' : 'مركز التكلفة' }, width: 24 },
          { key: 'code', label: L.code, width: 12 },
          { key: 'name', label: L.account, width: 36 },
          { key: 'amount', label: { en: 'Amount', ar: 'المبلغ' }, type: 'money' },
        ],
        rows: d.groups.flatMap((g: any) => g.accounts.map((a: any) => ({ ...a, group: g.name }))),
      },
    ],
  };
}

export function cashFlowSpec(d: any): ExportSpec {
  const lines = (title: string, section: any, withProfit: boolean) => [
    { name: title, amount: null },
    ...(withProfit ? [{ name: '  Net profit / صافي الربح', amount: d.netProfit }] : []),
    ...section.adjustments.map((l: any) => ({ code: l.code, name: `  ${l.name}`, amount: l.amount })),
    ...section.lines.map((l: any) => ({ code: l.code, name: `  ${l.name}`, amount: l.amount })),
    { name: '  Total / الإجمالي', amount: section.total },
  ];
  return {
    title: { en: 'Cash flow statement (indirect method)', ar: 'قائمة التدفقات النقدية (الطريقة غير المباشرة)' },
    filename: 'cash-flow',
    meta: meta(d.from, d.to),
    sheets: [
      {
        name: { en: 'Cash flow', ar: 'التدفقات النقدية' },
        columns: [
          { key: 'code', label: L.code, width: 12 },
          { key: 'name', label: L.description, width: 50 },
          { key: 'amount', label: { en: 'Amount', ar: 'المبلغ' }, type: 'money' },
        ],
        rows: [
          ...lines('Operating activities / الأنشطة التشغيلية', d.operating, true),
          ...lines('Investing activities / الأنشطة الاستثمارية', d.investing, false),
          ...lines('Financing activities / الأنشطة التمويلية', d.financing, false),
          { name: 'Net change in cash / صافي التغير في النقدية', amount: d.netChange },
          { name: 'Opening cash / النقدية أول المدة', amount: d.openingCash },
          { name: 'Closing cash / النقدية آخر المدة', amount: d.closingCash },
        ],
      },
    ],
  };
}

export function vatReturnSpec(d: any): ExportSpec {
  const rateCols = [
    { key: 'rate', label: { en: 'Rate %', ar: 'النسبة %' }, type: 'percent' as const },
    { key: 'taxableAmount', label: { en: 'Taxable amount', ar: 'المبلغ الخاضع' }, type: 'money' as const },
    { key: 'vatAmount', label: { en: 'VAT', ar: 'الضريبة' }, type: 'money' as const },
  ];
  return {
    title: { en: 'VAT return', ar: 'إقرار ضريبة القيمة المضافة' },
    filename: `vat-return-${d.from}-${d.to}`,
    meta: [...meta(d.from, d.to), { label: { en: 'Net VAT payable', ar: 'صافي الضريبة المستحقة' }, value: d.netVatPayable }],
    sheets: [
      {
        name: { en: 'Return', ar: 'الإقرار' },
        columns: [
          { key: 'box', label: { en: 'Box', ar: 'البند' }, width: 8 },
          { key: 'labelEn', label: { en: 'Description', ar: 'البيان (EN)' }, width: 44 },
          { key: 'labelAr', label: { en: 'Description (AR)', ar: 'البيان' }, width: 44 },
          { key: 'amount', label: { en: 'Amount', ar: 'المبلغ' }, type: 'money' },
          { key: 'adjustment', label: { en: 'Adjustment', ar: 'التعديلات' }, type: 'money' },
          { key: 'vat', label: { en: 'VAT', ar: 'الضريبة' }, type: 'money' },
        ],
        rows: d.boxes,
      },
      { name: { en: 'Sales by rate', ar: 'المبيعات حسب النسبة' }, columns: rateCols, rows: d.sales.byRate },
      { name: { en: 'Credit notes by rate', ar: 'الإشعارات الدائنة' }, columns: rateCols, rows: d.sales.creditNotes },
      { name: { en: 'Purchases by rate', ar: 'المشتريات حسب النسبة' }, columns: rateCols, rows: d.purchases.byRate },
      { name: { en: 'Purchase refunds', ar: 'مردودات المشتريات' }, columns: rateCols, rows: d.purchases.refunds },
    ],
  };
}

const GROUP_LABELS: Record<string, { en: string; ar: string }> = {
  product: { en: 'Product', ar: 'الصنف' },
  customer: { en: 'Customer', ar: 'العميل' },
  supplier: { en: 'Supplier', ar: 'المورد' },
  category: { en: 'Category', ar: 'المجموعة' },
  branch: { en: 'Branch', ar: 'الفرع' },
  salesperson: { en: 'Salesperson', ar: 'البائع' },
  month: { en: 'Month', ar: 'الشهر' },
  day: { en: 'Day', ar: 'اليوم' },
  invoice: { en: 'Invoice', ar: 'الفاتورة' },
};

export function analysisSpec(d: any, kind: 'sales' | 'purchases'): ExportSpec {
  const group = GROUP_LABELS[d.groupBy] ?? { en: d.groupBy, ar: d.groupBy };
  const isSales = kind === 'sales';
  return {
    title: isSales
      ? { en: `Sales analysis by ${group.en.toLowerCase()}`, ar: `تحليل المبيعات حسب ${group.ar}` }
      : { en: `Purchase analysis by ${group.en.toLowerCase()}`, ar: `تحليل المشتريات حسب ${group.ar}` },
    filename: `${kind}-by-${d.groupBy}`,
    meta: meta(d.from, d.to),
    sheets: [
      {
        name: group,
        columns: [
          { key: 'code', label: L.code, width: 16 },
          { key: 'name', label: group, width: 32 },
          ...(d.groupBy === 'invoice' ? [{ key: 'date', label: L.date, type: 'date' as const }] : []),
          { key: 'documents', label: L.count, type: 'number' },
          { key: 'quantity', label: L.quantity, type: 'number' },
          { key: 'net', label: L.net, type: 'money' },
          { key: 'tax', label: L.tax, type: 'money' },
          { key: 'total', label: L.total, type: 'money' },
          ...(isSales
            ? [
                { key: 'cost', label: L.cost, type: 'money' as const },
                { key: 'grossProfit', label: L.grossProfit, type: 'money' as const },
                { key: 'margin', label: L.margin, type: 'percent' as const },
              ]
            : [{ key: 'averageUnitCost', label: { en: 'Average unit cost', ar: 'متوسط تكلفة الوحدة' }, type: 'money' as const }]),
        ],
        rows: d.rows,
        totals: { name: 'Total / الإجمالي', ...d.totals },
      },
    ],
  };
}

export function dailySummarySpec(d: any): ExportSpec {
  return {
    title: { en: 'Daily sales and cash summary', ar: 'ملخص المبيعات والنقدية اليومي' },
    filename: 'daily-summary',
    meta: meta(d.from, d.to),
    sheets: [
      {
        name: { en: 'Daily summary', ar: 'الملخص اليومي' },
        columns: [
          { key: 'date', label: L.date, type: 'date' },
          { key: 'userName', label: { en: 'User', ar: 'المستخدم' }, width: 22 },
          { key: 'invoiceCount', label: { en: 'Invoices', ar: 'عدد الفواتير' }, type: 'number' },
          { key: 'invoiceTotal', label: { en: 'Invoice sales', ar: 'مبيعات الفواتير' }, type: 'money' },
          { key: 'posCount', label: { en: 'POS orders', ar: 'عدد طلبات نقاط البيع' }, type: 'number' },
          { key: 'posTotal', label: { en: 'POS sales', ar: 'مبيعات نقاط البيع' }, type: 'money' },
          { key: 'posCash', label: { en: 'POS cash', ar: 'نقدي نقاط البيع' }, type: 'money' },
          { key: 'posCard', label: { en: 'POS card', ar: 'شبكة نقاط البيع' }, type: 'money' },
          { key: 'receiptsCash', label: { en: 'Cash receipts', ar: 'مقبوضات نقدية' }, type: 'money' },
          { key: 'receiptsBank', label: { en: 'Bank receipts', ar: 'مقبوضات بنكية' }, type: 'money' },
          { key: 'paymentsCash', label: { en: 'Cash payments', ar: 'مدفوعات نقدية' }, type: 'money' },
          { key: 'paymentsBank', label: { en: 'Bank payments', ar: 'مدفوعات بنكية' }, type: 'money' },
          { key: 'netCash', label: { en: 'Net cash', ar: 'صافي النقدية' }, type: 'money' },
        ],
        rows: d.rows,
        totals: { userName: 'Total / الإجمالي', ...d.totals },
      },
    ],
  };
}
