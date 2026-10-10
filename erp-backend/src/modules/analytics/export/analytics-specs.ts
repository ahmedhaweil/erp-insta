import { ExportColumn, ExportSpec, L, Label } from '@modules/reports/export/report-export.service';
import { PROFIT_FIELDS } from '../services/analytics-calculator';

const C = {
  product: { key: 'name', label: { en: 'Item', ar: 'الصنف' }, width: 32 },
  code: { key: 'code', label: L.code, width: 12 },
  category: { key: 'categoryName', label: { en: 'Category', ar: 'التصنيف' }, width: 20 },
  onHand: { key: 'onHand', label: { en: 'On hand', ar: 'الرصيد' }, type: 'number' },
  stockValue: { key: 'stockValue', label: { en: 'Stock value', ar: 'قيمة المخزون' }, type: 'money' },
  dailyRate: { key: 'dailyRate', label: { en: 'Daily rate', ar: 'معدل البيع اليومي' }, type: 'number' },
  daysCover: { key: 'daysCover', label: { en: 'Days of cover', ar: 'يكفي كم يوم' }, type: 'number' },
  qtySold: { key: 'qtySold', label: { en: 'Qty sold', ar: 'الكمية المباعة' }, type: 'number' },
  sales: { key: 'sales', label: { en: 'Sales', ar: 'المبيعات' }, type: 'money' },
  cost: { key: 'cost', label: L.cost, type: 'money' },
  profit: { key: 'profit', label: L.grossProfit, type: 'money' },
  margin: { key: 'margin', label: L.margin, type: 'percent' },
  prevSales: { key: 'prevSales', label: { en: 'Previous sales', ar: 'مبيعات الفترة السابقة' }, type: 'money' },
  change: { key: 'salesChangePct', label: { en: 'Change %', ar: 'التغير %' }, type: 'percent' },
} satisfies Record<string, ExportColumn>;

const meta = (d: any) => [
  { label: L.from, value: d.period?.from },
  { label: L.to, value: d.period?.to },
];

function sheet(name: Label, columns: ExportColumn[], rows: any[], canSeeProfit: boolean) {
  return {
    name,
    columns: canSeeProfit ? columns : columns.filter((c) => !PROFIT_FIELDS.has(c.key)),
    rows,
  };
}

function spec(title: Label, filename: string, d: any, sheets: ExportSpec['sheets']): ExportSpec {
  return { title, filename, meta: meta(d), sheets };
}

export const analyticsSpecs = {
  slowMoving: (d: any, p: boolean) =>
    spec({ en: 'Slow-moving stock', ar: 'الأصناف الراكدة' }, 'slow-moving', d, [
      sheet({ en: 'Slow-moving', ar: 'الراكدة' }, [
        C.code, C.product, C.category, C.onHand, C.stockValue,
        { key: 'lastSaleDate', label: { en: 'Last sale', ar: 'آخر بيع' }, type: 'date' },
        { key: 'daysSinceLastSale', label: { en: 'Days without sale', ar: 'أيام بلا بيع' }, type: 'number' },
        { key: 'qtySoldInPeriod', label: C.qtySold.label, type: 'number' },
      ], d.rows, p),
    ]),
  lowStock: (d: any, p: boolean) =>
    spec({ en: 'Low stock', ar: 'نواقص المخزون' }, 'low-stock', d, [
      sheet({ en: 'Low stock', ar: 'النواقص' }, [
        C.code, C.product, C.category, C.onHand,
        { key: 'reorderLevel', label: { en: 'Reorder level', ar: 'الحد الأدنى' }, type: 'number' },
        { key: 'incoming', label: { en: 'Incoming', ar: 'وارد' }, type: 'number' },
        C.dailyRate, C.daysCover,
        { key: 'status', label: { en: 'Status', ar: 'الحالة' } },
      ], d.rows, p),
    ]),
  overstock: (d: any, p: boolean) =>
    spec({ en: 'Overstock', ar: 'المخزون الزائد' }, 'overstock', d, [
      sheet({ en: 'Overstock', ar: 'الزائد' }, [C.code, C.product, C.category, C.onHand, C.stockValue, C.qtySold, C.dailyRate, C.daysCover], d.rows, p),
    ]),
  items: (d: any, p: boolean) => {
    const cols: ExportColumn[] = [
      C.code, C.product, C.category,
      { key: 'quantity', label: L.quantity, type: 'number' },
      C.sales, C.cost, C.profit, C.margin, C.prevSales, C.change,
      { key: 'profitChange', label: { en: 'Profit change', ar: 'تغير الربح' }, type: 'money' },
    ];
    const list = (name: Label, rows: any[]) => sheet(name, cols, rows, p);
    return spec({ en: 'Item performance', ar: 'أداء الأصناف' }, 'item-performance', d, [
      list({ en: 'All items', ar: 'كل الأصناف' }, d.rows),
      list({ en: 'Top selling', ar: 'الأعلى مبيعاً' }, d.topSelling),
      ...(p
        ? [
            list({ en: 'Top profit', ar: 'الأعلى ربحاً' }, d.topProfit),
            list({ en: 'High sales low margin', ar: 'مبيعات عالية هامش ضعيف' }, d.highSalesLowMargin),
            list({ en: 'High margin low sales', ar: 'هامش عال مبيعات ضعيفة' }, d.highMarginLowSales),
            list({ en: 'Profit losers', ar: 'تراجع الربح' }, d.profitLosers),
          ]
        : []),
      list({ en: 'Declining', ar: 'المتراجعة' }, d.declining),
    ]);
  },
  categories: (d: any, p: boolean) =>
    spec({ en: 'Category performance', ar: 'أداء الأقسام' }, 'category-performance', d, [
      sheet({ en: 'Categories', ar: 'الأقسام' }, [
        { key: 'name', label: { en: 'Category', ar: 'التصنيف' }, width: 28 },
        { key: 'items', label: { en: 'Items', ar: 'عدد الأصناف' }, type: 'number' },
        { key: 'quantity', label: L.quantity, type: 'number' },
        C.sales, C.cost, C.profit, C.margin, C.prevSales, C.change,
        { key: 'share', label: { en: 'Share %', ar: 'النسبة %' }, type: 'percent' },
      ], d.rows, p),
    ]),
  purchaseSuggestions: (d: any, p: boolean) =>
    spec({ en: 'Purchase suggestions', ar: 'توصيات الشراء' }, 'purchase-suggestions', d, [
      sheet({ en: 'Suggestions', ar: 'التوصيات' }, [
        C.code, C.product, C.category, C.onHand,
        { key: 'incoming', label: { en: 'Incoming', ar: 'وارد' }, type: 'number' },
        C.dailyRate, C.daysCover,
        { key: 'suggestedQty', label: { en: 'Suggested qty', ar: 'الكمية المقترحة' }, type: 'number' },
        { key: 'unitCost', label: { en: 'Unit cost', ar: 'سعر الشراء' }, type: 'money' },
        { key: 'expectedCost', label: { en: 'Expected cost', ar: 'التكلفة المتوقعة' }, type: 'money' },
      ], d.rows, p),
    ]),
  customers: (d: any, p: boolean) => {
    const last = [
      { key: 'lastPurchaseDate', label: { en: 'Last purchase', ar: 'آخر شراء' }, type: 'date' },
      { key: 'daysSinceLastPurchase', label: { en: 'Days since', ar: 'أيام بلا شراء' }, type: 'number' },
    ] as ExportColumn[];
    const name = { key: 'name', label: { en: 'Customer', ar: 'العميل' }, width: 30 } as ExportColumn;
    return spec({ en: 'Customers', ar: 'العملاء' }, 'customers', d, [
      sheet({ en: 'Top customers', ar: 'أهم العملاء' }, [
        C.code, name, { key: 'invoiceCount', label: L.count, type: 'number' }, C.sales, C.profit, C.margin,
        ...last, C.prevSales, C.change,
      ], d.top, p),
      sheet({ en: 'Lost customers', ar: 'عملاء توقفوا' }, [C.code, name, C.prevSales, ...last], d.lost, p),
      sheet({ en: 'Stagnant customers', ar: 'عملاء بلا شراء' }, [C.code, name, { key: 'balance', label: L.balance, type: 'money' }, ...last], d.stagnant, p),
    ]);
  },
  returns: (d: any, p: boolean) =>
    spec({ en: 'Returns analysis', ar: 'تحليل المرتجعات' }, 'returns', d, [
      sheet({ en: 'Returns', ar: 'المرتجعات' }, [
        C.code, C.product,
        { key: 'returnQty', label: { en: 'Returned qty', ar: 'الكمية المرتجعة' }, type: 'number' },
        { key: 'returnValue', label: { en: 'Returned value', ar: 'قيمة المرتجع' }, type: 'money' },
        { key: 'returnDocuments', label: L.count, type: 'number' },
        C.sales,
        { key: 'returnPct', label: { en: 'Return %', ar: 'نسبة المرتجع %' }, type: 'percent' },
      ], d.rows, p),
    ]),
  dailySales: (d: any, p: boolean) =>
    spec({ en: 'Daily sales', ar: 'المبيعات اليومية' }, 'daily-sales', d, [
      sheet({ en: 'Daily sales', ar: 'المبيعات اليومية' }, [
        { key: 'date', label: L.date, type: 'date' },
        { key: 'invoiceCount', label: L.count, type: 'number' },
        C.sales,
        { key: 'returns', label: { en: 'Returns', ar: 'المرتجعات' }, type: 'money' },
        { key: 'netSales', label: L.net, type: 'money' },
        C.profit, C.margin,
        { key: 'averageInvoice', label: { en: 'Average invoice', ar: 'متوسط الفاتورة' }, type: 'money' },
      ], d.rows, p),
    ]),
  users: (d: any, p: boolean) =>
    spec({ en: 'Sales by user', ar: 'المبيعات بالمستخدم' }, 'sales-by-user', d, [
      sheet({ en: 'Users', ar: 'المستخدمون' }, [
        { key: 'name', label: { en: 'User', ar: 'المستخدم' }, width: 24 },
        { key: 'invoiceCount', label: L.count, type: 'number' },
        C.sales,
        { key: 'returns', label: { en: 'Returns', ar: 'المرتجعات' }, type: 'money' },
        { key: 'netSales', label: L.net, type: 'money' },
        { key: 'discounts', label: { en: 'Discounts', ar: 'الخصومات' }, type: 'money' },
        C.profit, C.margin,
        { key: 'averageInvoice', label: { en: 'Average invoice', ar: 'متوسط الفاتورة' }, type: 'money' },
      ], d.rows, p),
    ]),
};

export type AnalyticsSpecName = keyof typeof analyticsSpecs;
