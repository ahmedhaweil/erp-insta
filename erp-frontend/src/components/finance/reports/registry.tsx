import type { ReportSection } from '../ReportTable';

/**
 * Definitions of every report of the report center: endpoint, filters and how
 * the JSON result is turned into tables (mirrors the backend Excel specs in
 * report-specs.ts so the screen and the Excel file show the same columns).
 */

export type FilterKey =
  | 'from'
  | 'to'
  | 'asOf'
  | 'branchId'
  | 'costCenterId'
  | 'accountId'
  | 'includeChildren'
  | 'hierarchy'
  | 'includeZero'
  | 'maxLevel'
  | 'partner'
  | 'customerId'
  | 'supplierId'
  | 'productId'
  | 'salesGroupBy'
  | 'purchaseGroupBy'
  | 'source'
  | 'country'
  | 'fiscalYearId'
  | 'userId'
  | 'limit';

export type ReportGroup = 'financial' | 'management' | 'partners' | 'tax' | 'sales';

export interface RenderCtx {
  /** reports namespace translator */
  t: (key: string, values?: Record<string, any>) => string;
  has: (key: string) => boolean;
  /** localised name of a {nameAr,nameEn} object */
  name: (o: any) => string;
  locale: string;
}

export interface ReportResult {
  summary?: { label: string; value: unknown; money?: boolean }[];
  sections: ReportSection[];
}

export interface ReportDef {
  key: string;
  endpoint: string;
  group: ReportGroup;
  filters: FilterKey[];
  /** Filters that must be set before the report can run. */
  required?: FilterKey[];
  defaults?: Record<string, unknown>;
  render: (data: any, ctx: RenderCtx) => ReportResult;
}

const accName = (a: any, ctx: RenderCtx) => (ctx.locale === 'ar' ? a.nameAr || a.nameEn : a.nameEn || a.nameAr) ?? a.name;

const agedRender = (d: any, ctx: RenderCtx): ReportResult => {
  const { t } = ctx;
  return {
    summary: [
      { label: t('col.asOf'), value: d.asOf },
      { label: t('col.total'), value: d.total, money: true },
    ],
    sections: [
      {
        columns: [
          { key: 'partnerName', label: t('col.partner') },
          { key: 'current', label: t('col.notDue'), type: 'money' },
          { key: 'b1', label: t('col.b1'), type: 'money' },
          { key: 'b2', label: t('col.b2'), type: 'money' },
          { key: 'b3', label: t('col.b3'), type: 'money' },
          { key: 'b4', label: t('col.b4'), type: 'money' },
          { key: 'total', label: t('col.total'), type: 'money' },
        ],
        rows: d.partners.map((p: any) => ({
          id: p.partnerId,
          partnerName: p.partnerName,
          current: p.buckets.current,
          b1: p.buckets['1-30'],
          b2: p.buckets['31-60'],
          b3: p.buckets['61-90'],
          b4: p.buckets['90+'],
          total: p.total,
        })),
        totals: {
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
};

const ledgerRender = (d: any, ctx: RenderCtx): ReportResult => {
  const { t } = ctx;
  return {
    summary: [
      { label: t('col.account'), value: `${d.account.code} - ${accName(d.account, ctx)}` },
      { label: t('col.openingBalance'), value: d.openingBalance, money: true },
      { label: t('col.closingBalance'), value: d.closingBalance, money: true },
    ],
    sections: [
      {
        columns: [
          { key: 'date', label: t('col.date'), type: 'date' },
          { key: 'refNumber', label: t('col.entry') },
          { key: 'journal', label: t('col.journal') },
          { key: 'accountCode', label: t('col.code') },
          { key: 'description', label: t('col.description') },
          { key: 'costCenterCode', label: t('col.costCenter') },
          { key: 'debit', label: t('col.debit'), type: 'money' },
          { key: 'credit', label: t('col.credit'), type: 'money' },
          { key: 'balance', label: t('col.balance'), type: 'money' },
        ],
        rows: [
          { id: 'opening', description: t('col.openingBalance'), balance: d.openingBalance },
          ...d.entries.map((e: any, i: number) => ({ ...e, id: `${e.entryId}-${i}` })),
        ],
        totals: { debit: d.totalDebit, credit: d.totalCredit, balance: d.closingBalance },
      },
    ],
  };
};

const pnlByRender = (d: any, ctx: RenderCtx): ReportResult => {
  const { t } = ctx;
  return {
    summary: [
      { label: t('col.revenue'), value: d.totalRevenue, money: true },
      { label: t('col.expenses'), value: d.totalExpenses, money: true },
      { label: t('col.netProfit'), value: d.netProfit, money: true },
    ],
    sections: [
      {
        title: t('summary'),
        columns: [
          { key: 'code', label: t('col.code') },
          { key: 'name', label: t('col.name') },
          { key: 'revenue', label: t('col.revenue'), type: 'money' },
          { key: 'expenses', label: t('col.expenses'), type: 'money' },
          { key: 'netProfit', label: t('col.netProfit'), type: 'money' },
          { key: 'margin', label: t('col.margin'), type: 'percent' },
        ],
        rows: d.groups.map((g: any, i: number) => ({ ...g, id: g.id ?? `g${i}`, name: g.id ? g.name : t('unassigned') })),
        totals: { revenue: d.totalRevenue, expenses: d.totalExpenses, netProfit: d.netProfit },
      },
      {
        title: t('details'),
        columns: [
          { key: 'group', label: d.dimension === 'branch' ? t('col.branch') : t('col.costCenter') },
          { key: 'code', label: t('col.code') },
          { key: 'name', label: t('col.account') },
          { key: 'amount', label: t('col.amount'), type: 'money' },
        ],
        rows: d.groups.flatMap((g: any) =>
          g.accounts.map((a: any) => ({ ...a, id: `${g.id}-${a.accountId}`, group: g.id ? g.name : t('unassigned') })),
        ),
      },
    ],
  };
};

const analysisRender = (kind: 'sales' | 'purchases') => (d: any, ctx: RenderCtx): ReportResult => {
  const { t } = ctx;
  const isSales = kind === 'sales';
  return {
    summary: [
      { label: t('col.net'), value: d.totals.net, money: true },
      { label: t('col.tax'), value: d.totals.tax, money: true },
      { label: t('col.total'), value: d.totals.total, money: true },
      ...(isSales ? [{ label: t('col.grossProfit'), value: d.totals.grossProfit, money: true }] : []),
    ],
    sections: [
      {
        columns: [
          { key: 'code', label: t('col.code') },
          { key: 'name', label: t(`group.${d.groupBy}`) },
          ...(d.groupBy === 'invoice' ? [{ key: 'date', label: t('col.date'), type: 'date' as const }] : []),
          { key: 'documents', label: t('col.documents'), type: 'number' },
          { key: 'quantity', label: t('col.quantity'), type: 'number' },
          { key: 'net', label: t('col.net'), type: 'money' },
          { key: 'tax', label: t('col.tax'), type: 'money' },
          { key: 'total', label: t('col.total'), type: 'money' },
          ...(isSales
            ? [
                { key: 'cost', label: t('col.cost'), type: 'money' as const },
                { key: 'grossProfit', label: t('col.grossProfit'), type: 'money' as const },
                { key: 'margin', label: t('col.margin'), type: 'percent' as const },
              ]
            : [{ key: 'averageUnitCost', label: t('col.averageUnitCost'), type: 'money' as const }]),
        ],
        rows: d.rows.map((r: any, i: number) => ({ ...r, id: r.key ?? i })),
        totals: d.totals,
      },
    ],
  };
};

const sheetRender = (d: any, ctx: RenderCtx, kind: 'pl' | 'bs'): ReportResult => {
  const { t } = ctx;
  const cols = [
    { key: 'code', label: t('col.code') },
    { key: 'name', label: t('col.account') },
    { key: 'amount', label: t('col.amount'), type: 'money' as const },
  ];
  const map = (rows: any[], sign: number) =>
    rows.map((a: any) => ({ id: a.id ?? a.accountId ?? a.code, code: a.code, name: accName(a, ctx), amount: sign * Number(a.balance) }));
  if (kind === 'pl') {
    return {
      summary: [
        { label: t('col.revenue'), value: d.totalRevenue, money: true },
        { label: t('col.expenses'), value: d.totalExpenses, money: true },
        { label: t('col.netIncome'), value: d.netIncome, money: true },
      ],
      sections: [
        { title: t('col.revenue'), columns: cols, rows: map(d.revenue, -1), totals: { amount: d.totalRevenue } },
        { title: t('col.expenses'), columns: cols, rows: map(d.expenses, 1), totals: { amount: d.totalExpenses } },
      ],
    };
  }
  return {
    summary: [
      { label: t('col.totalAssets'), value: d.totalAssets, money: true },
      { label: t('col.totalLiabilitiesAndEquity'), value: d.totalLiabilitiesAndEquity, money: true },
    ],
    sections: [
      { title: t('col.assets'), columns: cols, rows: map(d.assets, 1), totals: { amount: d.totalAssets } },
      {
        title: t('col.liabilitiesAndEquity'),
        columns: cols,
        rows: [
          ...map(d.liabilities, -1),
          ...map(d.equity, -1),
          { id: 'current-earnings', name: t('col.currentEarnings'), amount: d.currentEarnings },
        ],
        totals: { amount: d.totalLiabilitiesAndEquity },
      },
    ],
  };
};

export const REPORTS: ReportDef[] = [
  {
    key: 'trial-balance',
    endpoint: 'trial-balance',
    group: 'financial',
    filters: ['from', 'to', 'branchId', 'costCenterId', 'hierarchy', 'includeZero', 'maxLevel'],
    defaults: { hierarchy: true },
    render: (d, ctx) => {
      const { t } = ctx;
      return {
        sections: [
          {
            columns: [
              { key: 'code', label: t('col.code') },
              { key: 'name', label: t('col.account') },
              { key: 'openingDebit', label: t('col.openingDebit'), type: 'money' },
              { key: 'openingCredit', label: t('col.openingCredit'), type: 'money' },
              { key: 'periodDebit', label: t('col.periodDebit'), type: 'money' },
              { key: 'periodCredit', label: t('col.periodCredit'), type: 'money' },
              { key: 'closingDebit', label: t('col.closingDebit'), type: 'money' },
              { key: 'closingCredit', label: t('col.closingCredit'), type: 'money' },
            ],
            rows: d.accounts.map((a: any) => ({ ...a, id: a.accountId, name: accName(a, ctx) })),
            totals: d.totals,
            rowClass: (r) => (r.isGroup ? 'font-semibold bg-gray-50/70' : undefined),
            indent: (r) => r.level ?? 0,
          },
        ],
      };
    },
  },
  {
    key: 'general-ledger',
    endpoint: 'general-ledger',
    group: 'financial',
    filters: ['accountId', 'from', 'to', 'branchId', 'costCenterId', 'includeChildren'],
    required: ['accountId'],
    render: ledgerRender,
  },
  {
    key: 'account-statement',
    endpoint: 'account-statement',
    group: 'financial',
    filters: ['accountId', 'from', 'to', 'branchId', 'costCenterId'],
    required: ['accountId'],
    render: ledgerRender,
  },
  { key: 'profit-loss', endpoint: 'profit-loss', group: 'financial', filters: ['from', 'to'], render: (d, c) => sheetRender(d, c, 'pl') },
  { key: 'balance-sheet', endpoint: 'balance-sheet', group: 'financial', filters: ['asOf'], render: (d, c) => sheetRender(d, c, 'bs') },
  {
    key: 'cash-flow',
    endpoint: 'cash-flow',
    group: 'financial',
    filters: ['from', 'to'],
    render: (d, ctx) => {
      const { t } = ctx;
      const lines = (title: string, s: any, withProfit: boolean) => [
        { id: `${title}-h`, name: title, header: true },
        ...(withProfit ? [{ id: `${title}-np`, name: t('col.netProfit'), amount: d.netProfit, level: 1 }] : []),
        ...s.adjustments.map((l: any, i: number) => ({ ...l, id: `${title}-a${i}`, level: 1 })),
        ...s.lines.map((l: any, i: number) => ({ ...l, id: `${title}-l${i}`, level: 1 })),
        { id: `${title}-t`, name: t('col.total'), amount: s.total, header: true },
      ];
      return {
        summary: [
          { label: t('col.openingCash'), value: d.openingCash, money: true },
          { label: t('col.netChange'), value: d.netChange, money: true },
          { label: t('col.closingCash'), value: d.closingCash, money: true },
        ],
        sections: [
          {
            columns: [
              { key: 'code', label: t('col.code') },
              { key: 'name', label: t('col.description') },
              { key: 'amount', label: t('col.amount'), type: 'money' },
            ],
            rows: [
              ...lines(t('col.operating'), d.operating, true),
              ...lines(t('col.investing'), d.investing, false),
              ...lines(t('col.financing'), d.financing, false),
              { id: 'net', name: t('col.netChange'), amount: d.netChange, header: true },
              { id: 'open', name: t('col.openingCash'), amount: d.openingCash },
              { id: 'close', name: t('col.closingCash'), amount: d.closingCash, header: true },
            ],
            rowClass: (r) => (r.header ? 'font-semibold bg-gray-50/70' : undefined),
            indent: (r) => r.level ?? 0,
          },
        ],
      };
    },
  },
  { key: 'cost-center-pnl', endpoint: 'cost-center-pnl', group: 'management', filters: ['from', 'to', 'branchId'], render: pnlByRender },
  { key: 'branch-pnl', endpoint: 'branch-pnl', group: 'management', filters: ['from', 'to', 'costCenterId'], render: pnlByRender },
  {
    key: 'budget-vs-actual',
    endpoint: 'budget-vs-actual',
    group: 'management',
    filters: ['fiscalYearId'],
    required: ['fiscalYearId'],
    render: (d, ctx) => {
      const { t } = ctx;
      return {
        summary: [{ label: t('col.fiscalYear'), value: d.fiscalYear?.name }],
        sections: [
          {
            columns: [
              { key: 'accountCode', label: t('col.code') },
              { key: 'accountName', label: t('col.account') },
              { key: 'planned', label: t('col.planned'), type: 'money' },
              { key: 'actual', label: t('col.actual'), type: 'money' },
              { key: 'variance', label: t('col.variance'), type: 'money' },
              { key: 'achievement', label: t('col.achievement'), type: 'percent' },
            ],
            rows: (d.lines ?? []).map((l: any, i: number) => ({ ...l, id: l.budgetId ?? l.accountId ?? i })),
          },
        ],
      };
    },
  },
  {
    key: 'partner-statement',
    endpoint: 'partner-statement',
    group: 'partners',
    filters: ['partner', 'from', 'to'],
    required: ['partner'],
    defaults: { partnerType: 'customer' },
    render: (d, ctx) => {
      const { t } = ctx;
      return {
        summary: [
          { label: t('col.partner'), value: `${d.partner.code} - ${accName(d.partner, ctx)}` },
          { label: t('col.taxId'), value: d.partner.taxId },
          { label: t('col.openingBalance'), value: d.openingBalance, money: true },
          { label: t('col.closingBalance'), value: d.closingBalance, money: true },
        ],
        sections: [
          {
            columns: [
              { key: 'date', label: t('col.date'), type: 'date' },
              { key: 'documentType', label: t('col.type'), render: (r) => (r.documentType ? (ctx.has(`doc.${r.documentType}`) ? t(`doc.${r.documentType}`) : r.documentType) : '') },
              { key: 'number', label: t('col.number') },
              { key: 'reference', label: t('col.reference') },
              { key: 'description', label: t('col.description') },
              { key: 'dueDate', label: t('col.dueDate'), type: 'date' },
              { key: 'debit', label: t('col.debit'), type: 'money' },
              { key: 'credit', label: t('col.credit'), type: 'money' },
              { key: 'balance', label: t('col.balance'), type: 'money' },
            ],
            rows: [
              { id: 'opening', description: t('col.openingBalance'), balance: d.openingBalance },
              ...d.lines.map((l: any, i: number) => ({ ...l, id: `${l.documentId}-${i}` })),
            ],
            totals: { debit: d.totalDebit, credit: d.totalCredit, balance: d.closingBalance },
          },
        ],
      };
    },
  },
  { key: 'aged-receivables', endpoint: 'aged-receivables', group: 'partners', filters: ['asOf'], render: agedRender },
  { key: 'aged-payables', endpoint: 'aged-payables', group: 'partners', filters: ['asOf'], render: agedRender },
  {
    key: 'vat-return',
    endpoint: 'vat-return',
    group: 'tax',
    filters: ['from', 'to', 'branchId', 'country'],
    render: (d, ctx) => {
      const { t } = ctx;
      const rateCols = [
        { key: 'rate', label: t('col.rate'), type: 'percent' as const },
        { key: 'taxableAmount', label: t('col.taxableAmount'), type: 'money' as const },
        { key: 'vatAmount', label: t('col.vat'), type: 'money' as const },
      ];
      const withId = (rows: any[]) => (rows ?? []).map((r, i) => ({ ...r, id: i }));
      return {
        summary: [
          { label: t('col.outputVat'), value: d.sales.outputVat, money: true },
          { label: t('col.inputVat'), value: d.purchases.inputVat, money: true },
          { label: t('col.netVatPayable'), value: d.netVatPayable, money: true },
          ...(d.ledger ? [{ label: t('col.ledgerNetVat'), value: d.ledger.netVatPayable, money: true }] : []),
        ],
        sections: [
          {
            title: t('vatBoxes'),
            columns: [
              { key: 'box', label: t('col.box') },
              { key: 'label', label: t('col.description') },
              { key: 'amount', label: t('col.amount'), type: 'money' },
              { key: 'adjustment', label: t('col.adjustment'), type: 'money' },
              { key: 'vat', label: t('col.vat'), type: 'money' },
            ],
            rows: d.boxes.map((b: any) => ({ ...b, id: b.box, label: ctx.locale === 'ar' ? b.labelAr : b.labelEn })),
          },
          { title: t('salesByRate'), columns: rateCols, rows: withId(d.sales.byRate) },
          { title: t('creditNotesByRate'), columns: rateCols, rows: withId(d.sales.creditNotes) },
          { title: t('purchasesByRate'), columns: rateCols, rows: withId(d.purchases.byRate) },
          { title: t('purchaseRefunds'), columns: rateCols, rows: withId(d.purchases.refunds) },
        ],
      };
    },
  },
  {
    key: 'sales-analysis',
    endpoint: 'sales-analysis',
    group: 'sales',
    filters: ['from', 'to', 'salesGroupBy', 'source', 'branchId', 'customerId', 'productId', 'limit'],
    defaults: { groupBy: 'product' },
    render: analysisRender('sales'),
  },
  {
    key: 'purchase-analysis',
    endpoint: 'purchase-analysis',
    group: 'sales',
    filters: ['from', 'to', 'purchaseGroupBy', 'branchId', 'supplierId', 'productId', 'limit'],
    defaults: { groupBy: 'supplier' },
    render: analysisRender('purchases'),
  },
  {
    key: 'daily-summary',
    endpoint: 'daily-summary',
    group: 'sales',
    filters: ['from', 'to', 'branchId', 'userId'],
    render: (d, ctx) => {
      const { t } = ctx;
      const money = ['invoiceTotal', 'posTotal', 'posCash', 'posCard', 'receiptsCash', 'receiptsBank', 'paymentsCash', 'paymentsBank', 'netCash'];
      return {
        sections: [
          {
            columns: [
              { key: 'date', label: t('col.date'), type: 'date' },
              { key: 'userName', label: t('col.user') },
              { key: 'invoiceCount', label: t('col.invoiceCount'), type: 'number' },
              ...money.map((k) => ({ key: k, label: t(`col.${k}`), type: 'money' as const })).slice(0, 1),
              { key: 'posCount', label: t('col.posCount'), type: 'number' },
              ...money.slice(1).map((k) => ({ key: k, label: t(`col.${k}`), type: 'money' as const })),
            ],
            rows: d.rows.map((r: any, i: number) => ({ ...r, id: `${r.date}-${r.userId}-${i}` })),
            totals: d.totals,
          },
        ],
      };
    },
  },
];

export const REPORT_GROUPS: ReportGroup[] = ['financial', 'management', 'partners', 'tax', 'sales'];

export const findReport = (key: string) => REPORTS.find((r) => r.key === key);
