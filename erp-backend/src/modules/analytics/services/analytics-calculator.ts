/**
 * Pure computations of the business analytics (ported from Instasoft
 * module/analytics.vb): periods, medians, days of cover, purchase
 * suggestions, item quadrants, rule-based insights and alert buckets.
 * No I/O here, so every rule is unit-tested in isolation.
 */

export type Severity = 'critical' | 'warning' | 'info' | 'good';

export interface Bilingual {
  ar: string;
  en: string;
}

const round = (n: number, d = 2) => {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f;
};
export const r2 = (n: number) => round(n, 2);
export const r4 = (n: number) => round(n, 4);

// ───────────────────────────── periods ─────────────────────────────

export interface Period {
  from: string;
  to: string;
  /** Inclusive number of days. */
  days: number;
  /** Comparison period: same length, immediately before `from`. */
  prevFrom: string;
  prevTo: string;
}

const MS_DAY = 86400000;
const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / MS_DAY);
}

export function shiftDays(iso: string, days: number): string {
  return toIso(toMs(iso) + days * MS_DAY);
}

/** from/to default to the first of the current month → today. */
export function resolvePeriod(from: string | undefined, to: string | undefined, today: string): Period {
  const end = to ?? today;
  const start = from ?? `${(to ?? today).slice(0, 7)}-01`;
  if (toMs(start) > toMs(end)) throw new RangeError('from must not be after to');
  const days = daysBetween(start, end) + 1;
  const prevTo = shiftDays(start, -1);
  const prevFrom = shiftDays(prevTo, -(days - 1));
  return { from: start, to: end, days, prevFrom, prevTo };
}

// ───────────────────────────── statistics ─────────────────────────────

/** Proper median (mean of the two middle values for an even count); 0 for no values. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Change % against the previous value; 0 when the previous value is 0. */
export function changePct(current: number, previous: number): number {
  if (!previous) return 0;
  return r2(((current - previous) / Math.abs(previous)) * 100);
}

export function marginPct(net: number, profit: number): number {
  return net ? r2((profit / net) * 100) : 0;
}

export function sharePct(part: number, total: number): number {
  return total > 0 ? r2((part / total) * 100) : 0;
}

// ───────────────────────────── stock ─────────────────────────────

export function dailyRate(qtySold: number, days: number): number {
  return qtySold > 0 && days > 0 ? qtySold / days : 0;
}

/** Days the on-hand quantity lasts at the daily rate; null when nothing sells. */
export function daysCover(onHand: number, rate: number): number | null {
  if (!(rate > 0)) return null;
  return r2(Math.max(onHand, 0) / rate);
}

export type StockStatus = 'out_of_stock' | 'below_minimum' | 'running_out';

/**
 * Low-stock status: out of stock (≤ 0), at/below the reorder level, or
 * running out within `lowCoverDays` at the current rate; null when fine.
 */
export function lowStockStatus(
  onHand: number,
  reorderLevel: number,
  cover: number | null,
  lowCoverDays: number,
): StockStatus | null {
  if (onHand <= 0) return 'out_of_stock';
  if (reorderLevel > 0 && onHand <= reorderLevel) return 'below_minimum';
  if (cover !== null && cover <= lowCoverDays) return 'running_out';
  return null;
}

export function isOverstock(onHand: number, qtySold: number, cover: number | null, overstockDays: number) {
  return onHand > 0 && qtySold > 0 && cover !== null && cover >= overstockDays;
}

/** In stock and never sold, or last sale at least `threshold` days ago. */
export function isSlowMoving(onHand: number, daysSinceLastSale: number | null, threshold: number) {
  return onHand > 0 && (daysSinceLastSale === null || daysSinceLastSale >= threshold);
}

/**
 * Consumption-based purchase suggestion:
 * ceil(dailyRate × coverDays − (onHand + incoming)), never negative.
 */
export function suggestedPurchaseQty(rate: number, coverDays: number, onHand: number, incoming: number): number {
  const need = rate * coverDays - (Math.max(onHand, 0) + Math.max(incoming, 0));
  if (need <= 1e-9) return 0;
  return Math.ceil(need - 1e-9);
}

// ───────────────────────────── items ─────────────────────────────

export interface ItemPerformance {
  key: string;
  code: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string;
  quantity: number;
  sales: number;
  cost: number;
  profit: number;
  margin: number;
  prevQuantity: number;
  prevSales: number;
  prevProfit: number;
  salesChangePct: number;
  profitChange: number;
}

export interface ItemQuadrants<T extends ItemPerformance = ItemPerformance> {
  medianSales: number;
  averageMargin: number;
  topSelling: T[];
  topProfit: T[];
  /** Sales ≥ median and margin < average margin (lowest margin first). */
  highSalesLowMargin: T[];
  /** Sales < median and margin > average margin (highest margin first). */
  highMarginLowSales: T[];
  /** Sold in the previous period and sales went down (largest drop first). */
  declining: T[];
  /** Profit lower than in the previous period (largest loss first). */
  profitLosers: T[];
}

/**
 * Derived item lists. Quadrants consider items with sales in the current
 * period; the average margin is the simple mean of their margins.
 */
export function classifyItems<T extends ItemPerformance>(items: T[], limit = 20): ItemQuadrants<T> {
  const selling = items.filter((i) => i.sales > 0);
  const medianSales = r4(median(selling.map((i) => i.sales)));
  const averageMargin = r2(mean(selling.map((i) => i.margin)));
  const top = (list: T[]) => list.slice(0, limit);
  return {
    medianSales,
    averageMargin,
    topSelling: top([...selling].sort((a, b) => b.sales - a.sales)),
    topProfit: top([...selling].sort((a, b) => b.profit - a.profit)),
    highSalesLowMargin: top(
      selling.filter((i) => i.sales >= medianSales && i.margin < averageMargin).sort((a, b) => a.margin - b.margin),
    ),
    highMarginLowSales: top(
      selling.filter((i) => i.sales < medianSales && i.margin > averageMargin).sort((a, b) => b.margin - a.margin),
    ),
    declining: top(
      items.filter((i) => i.prevSales > 0 && i.salesChangePct < 0).sort((a, b) => a.salesChangePct - b.salesChangePct),
    ),
    profitLosers: top(items.filter((i) => i.profitChange < 0).sort((a, b) => a.profitChange - b.profitChange)),
  };
}

// ───────────────────────────── profit visibility ─────────────────────────────

/** Fields hidden from users without analytics/profit/read. */
export const PROFIT_FIELDS = new Set([
  'cost',
  'prevCost',
  'unitCost',
  'profit',
  'prevProfit',
  'profitChange',
  'profitChangePct',
  'grossProfit',
  'prevGrossProfit',
  'grossProfitChangePct',
  'margin',
  'prevMargin',
  'marginChange',
  'averageMargin',
  'stockValue',
  'slowValue',
  'expectedCost',
  'costChangePct',
]);

/** Removes profit, cost, margin and stock value fields (recursively). */
export function stripProfit<T>(data: T): T {
  if (Array.isArray(data)) return data.map((d) => stripProfit(d)) as unknown as T;
  if (data && typeof data === 'object' && !(data instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (PROFIT_FIELDS.has(k)) continue;
      out[k] = stripProfit(v);
    }
    return out as T;
  }
  return data;
}

// ───────────────────────────── insights ─────────────────────────────

export interface InsightThresholds {
  salesDropPct: number;
  salesRisePct: number;
  profitDropPct: number;
  marginDropPoints: number;
  slowValueCriticalPct: number;
  topItemSharePct: number;
  topCustomerSharePct: number;
  returnsRatioPct: number;
  expensesProfitWarnPct: number;
  posCashDiffMin: number;
  overstockDays: number;
  purchaseCoverDays: number;
}

export const DEFAULT_INSIGHT_THRESHOLDS: InsightThresholds = {
  salesDropPct: 5,
  salesRisePct: 5,
  profitDropPct: 5,
  marginDropPoints: 2,
  slowValueCriticalPct: 25,
  topItemSharePct: 30,
  topCustomerSharePct: 25,
  returnsRatioPct: 5,
  expensesProfitWarnPct: 60,
  posCashDiffMin: 1,
  overstockDays: 90,
  purchaseCoverDays: 30,
};

export interface InsightInput {
  /** Gross sales (before returns), returns and net sales. */
  sales: number;
  returns: number;
  prevReturns: number;
  netSales: number;
  prevNetSales: number;
  grossProfit: number;
  prevGrossProfit: number;
  margin: number;
  prevMargin: number;
  expenses: number;
  stockValue: number;
  outOfStockCount: number;
  lowStockCount: number;
  slowCount: number;
  slowValue: number;
  overstockCount: number;
  highMarginLowSales: { count: number; topName?: string; topMargin?: number };
  highSalesLowMargin: { count: number; topName?: string; topMargin?: number };
  topItem?: { name: string; sales: number };
  topCustomer?: { name: string; sales: number };
  lostCustomers: { count: number; prevSales: number };
  topReturnItem?: string;
  purchaseSuggestions: { count: number; expectedCost: number };
  /** Largest absolute POS cash difference by user in the period. */
  worstCashDifference?: { userName: string; amount: number };
  negativeTreasuries: string[];
}

export interface Insight {
  code: string;
  severity: Severity;
  title: Bilingual;
  message: Bilingual;
  /** Suggested action. */
  action?: Bilingual;
  /** Analytics list that explains the card (endpoint name). */
  target?: string;
  value: number | null;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 };

export function sortInsights(list: Insight[]): Insight[] {
  return list
    .map((x, i) => ({ x, i }))
    .sort((a, b) => SEVERITY_RANK[a.x.severity] - SEVERITY_RANK[b.x.severity] || a.i - b.i)
    .map(({ x }) => x);
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const abs1 = (n: number) => r2(Math.abs(n));

/**
 * Rule-based insight cards. Profit, margin, expense-vs-profit, margin
 * quadrant and expected-cost rules are skipped without the profit permission.
 */
export function buildInsights(
  k: InsightInput,
  t: InsightThresholds = DEFAULT_INSIGHT_THRESHOLDS,
  canSeeProfit = true,
): Insight[] {
  const out: Insight[] = [];
  const add = (i: Insight) => out.push(i);

  // sales trend
  const salesChange = changePct(k.netSales, k.prevNetSales);
  if (k.prevNetSales > 0 && salesChange <= -t.salesDropPct) {
    add({
      code: 'sales_down',
      severity: 'warning',
      title: { ar: `انخفضت المبيعات ${abs1(salesChange)}%`, en: `Sales down ${abs1(salesChange)}%` },
      message: {
        ar: `المبيعات ${fmt(k.netSales)} مقابل ${fmt(k.prevNetSales)} في الفترة السابقة بنفس الطول.`,
        en: `Net sales ${fmt(k.netSales)} vs ${fmt(k.prevNetSales)} in the previous period of the same length.`,
      },
      action: {
        ar: 'راجع الأصناف المتراجعة وابدأ بأكبر ثلاثة.',
        en: 'Review declining items, starting with the three largest.',
      },
      target: 'items',
      value: salesChange,
    });
  } else if (k.prevNetSales > 0 && salesChange >= t.salesRisePct) {
    add({
      code: 'sales_up',
      severity: 'good',
      title: { ar: `ارتفعت المبيعات ${abs1(salesChange)}%`, en: `Sales up ${abs1(salesChange)}%` },
      message: {
        ar: `المبيعات ${fmt(k.netSales)} مقابل ${fmt(k.prevNetSales)}.`,
        en: `Net sales ${fmt(k.netSales)} vs ${fmt(k.prevNetSales)}.`,
      },
      action: {
        ar: 'تأكد من توفر الأصناف الصاعدة قبل أن تنفد.',
        en: 'Keep the rising items in stock.',
      },
      target: 'items',
      value: salesChange,
    });
  }

  // profit and margin
  if (canSeeProfit) {
    const profitChange = changePct(k.grossProfit, k.prevGrossProfit);
    if (k.prevGrossProfit > 0 && profitChange <= -t.profitDropPct) {
      const causesAr: string[] = [];
      const causesEn: string[] = [];
      if (salesChange < 0) {
        causesAr.push(`انخفاض المبيعات ${abs1(salesChange)}%`);
        causesEn.push(`sales down ${abs1(salesChange)}%`);
      }
      if (k.margin < k.prevMargin) {
        causesAr.push(`تراجع الهامش من ${k.prevMargin}% إلى ${k.margin}%`);
        causesEn.push(`margin down from ${k.prevMargin}% to ${k.margin}%`);
      }
      if (k.returns > k.prevReturns) {
        causesAr.push('زيادة المرتجعات');
        causesEn.push('more returns');
      }
      add({
        code: 'profit_down',
        severity: 'critical',
        title: { ar: `انخفض الربح ${abs1(profitChange)}%`, en: `Gross profit down ${abs1(profitChange)}%` },
        message: causesAr.length
          ? { ar: `الأسباب الظاهرة: ${causesAr.join(' و')}.`, en: `Visible causes: ${causesEn.join(', ')}.` }
          : { ar: 'البيانات الحالية لا تُظهر سبباً واضحاً.', en: 'The data shows no obvious cause.' },
        action: {
          ar: 'راجع الأصناف التي خسرت ربحاً مقارنة بالفترة السابقة.',
          en: 'Review the items whose profit fell against the previous period.',
        },
        target: 'items',
        value: profitChange,
      });
    }
    if (k.prevMargin > 0 && k.margin < k.prevMargin - t.marginDropPoints) {
      const drop = r2(k.prevMargin - k.margin);
      add({
        code: 'margin_down',
        severity: 'warning',
        title: { ar: `تراجع هامش الربح ${drop} نقطة`, en: `Margin down ${drop} points` },
        message: {
          ar: `من ${k.prevMargin}% إلى ${k.margin}% — كل وحدة مبيعات صارت تعطي ربحاً أقل.`,
          en: `From ${k.prevMargin}% to ${k.margin}%: each unit of sales now earns less.`,
        },
        action: {
          ar: 'ارتفعت تكلفة الشراء أو زادت الخصومات: راجع «مبيعات عالية · هامش ضعيف».',
          en: 'Purchase costs rose or discounts grew: review high-sales / low-margin items.',
        },
        target: 'items',
        value: drop,
      });
    }
  }

  // stock
  if (k.outOfStockCount > 0) {
    add({
      code: 'out_of_stock',
      severity: 'critical',
      title: { ar: `${k.outOfStockCount} صنفاً نفد من المخزن`, en: `${k.outOfStockCount} items out of stock` },
      message: {
        ar: 'أصناف رصيدها صفر أو أقل — كل طلب عليها مبيعات ضائعة.',
        en: 'Items with zero or negative stock: every request for them is a lost sale.',
      },
      action: { ar: 'راجع نواقص المخزون واطلبها اليوم.', en: 'Review low stock and reorder today.' },
      target: 'low-stock',
      value: k.outOfStockCount,
    });
  }
  if (k.lowStockCount > 0) {
    add({
      code: 'low_stock',
      severity: 'warning',
      title: { ar: `${k.lowStockCount} صنفاً يوشك على النفاد`, en: `${k.lowStockCount} items running low` },
      message: {
        ar: 'تحت الحد الأدنى أو يكفي أياماً قليلة بمعدل البيع الحالي.',
        en: 'At or below the reorder level, or a few days of cover left at the current rate.',
      },
      action: { ar: 'توصيات الشراء تحسب الكمية المطلوبة.', en: 'Purchase suggestions compute the quantity to buy.' },
      target: 'purchase-suggestions',
      value: k.lowStockCount,
    });
  }
  if (k.slowCount > 0) {
    const pct = sharePct(k.slowValue, k.stockValue);
    const critical = canSeeProfit && k.stockValue > 0 && pct > t.slowValueCriticalPct;
    add({
      code: 'slow_stock',
      severity: critical ? 'critical' : 'warning',
      title: { ar: `${k.slowCount} صنفاً راكداً`, en: `${k.slowCount} slow-moving items` },
      message:
        canSeeProfit && k.slowValue > 0
          ? {
              ar: `رأس مال مجمَّد قدره ${fmt(k.slowValue)}${k.stockValue > 0 ? ` — ${pct}% من قيمة المخزون` : ''}.`,
              en: `${fmt(k.slowValue)} of capital tied up${k.stockValue > 0 ? ` (${pct}% of stock value)` : ''}.`,
            }
          : {
              ar: 'أصناف لم تُبع منذ مدة تتجاوز عتبة الركود.',
              en: 'Items not sold for longer than the stagnation threshold.',
            },
      action: {
        ar: 'اعمل عرضاً لتصريفها أو أوقف إعادة شرائها.',
        en: 'Run a promotion to clear them or stop reordering them.',
      },
      target: 'slow-moving',
      value: k.slowCount,
    });
  }
  if (k.overstockCount > 0) {
    add({
      code: 'overstock',
      severity: 'info',
      title: { ar: `${k.overstockCount} صنفاً كميته زائدة`, en: `${k.overstockCount} overstocked items` },
      message: {
        ar: `تغطية المخزون تتجاوز ${t.overstockDays} يوماً بمعدل البيع الحالي.`,
        en: `Stock covers more than ${t.overstockDays} days at the current sales rate.`,
      },
      action: {
        ar: 'قلّل إعادة الشراء أو حوّله لفرع يبيعه أسرع.',
        en: 'Reduce reordering or transfer to a branch that sells faster.',
      },
      target: 'overstock',
      value: k.overstockCount,
    });
  }

  // profit opportunities
  if (canSeeProfit && k.highMarginLowSales.count > 0) {
    add({
      code: 'high_margin_low_sales',
      severity: 'good',
      title: {
        ar: `${k.highMarginLowSales.count} صنفاً هامشه عالٍ ومبيعاته ضعيفة`,
        en: `${k.highMarginLowSales.count} high-margin items with low sales`,
      },
      message: {
        ar: `أعلاها «${k.highMarginLowSales.topName ?? ''}» بهامش ${k.highMarginLowSales.topMargin ?? 0}% — فرصة ربح غير مستغلّة.`,
        en: `Top: "${k.highMarginLowSales.topName ?? ''}" at ${k.highMarginLowSales.topMargin ?? 0}% margin, an untapped opportunity.`,
      },
      action: { ar: 'اعرضها بشكل أوضح واقترحها عند البيع.', en: 'Give them better placement and upsell them.' },
      target: 'items',
      value: k.highMarginLowSales.count,
    });
  }
  if (canSeeProfit && k.highSalesLowMargin.count > 0) {
    add({
      code: 'high_sales_low_margin',
      severity: 'warning',
      title: {
        ar: `${k.highSalesLowMargin.count} صنفاً يبيع كثيراً ويربح قليلاً`,
        en: `${k.highSalesLowMargin.count} best sellers with low margin`,
      },
      message: {
        ar: `أبرزها «${k.highSalesLowMargin.topName ?? ''}» بهامش ${k.highSalesLowMargin.topMargin ?? 0}% فقط.`,
        en: `Most notable: "${k.highSalesLowMargin.topName ?? ''}" at only ${k.highSalesLowMargin.topMargin ?? 0}% margin.`,
      },
      action: {
        ar: 'راجع سعر البيع أو تفاوض على سعر الشراء.',
        en: 'Review the selling price or negotiate the purchase price.',
      },
      target: 'items',
      value: k.highSalesLowMargin.count,
    });
  }

  // concentration
  if (k.topItem && k.netSales > 0) {
    const share = sharePct(k.topItem.sales, k.netSales);
    if (share >= t.topItemSharePct) {
      add({
        code: 'item_concentration',
        severity: 'warning',
        title: { ar: 'اعتماد كبير على صنف واحد', en: 'Heavy reliance on one item' },
        message: {
          ar: `«${k.topItem.name}» وحده ${share}% من المبيعات.`,
          en: `"${k.topItem.name}" alone is ${share}% of sales.`,
        },
        action: { ar: 'أمّن مورداً بديلاً ووسّع البدائل.', en: 'Secure an alternative supplier and widen the range.' },
        target: 'items',
        value: share,
      });
    }
  }
  if (k.topCustomer && k.netSales > 0) {
    const share = sharePct(k.topCustomer.sales, k.netSales);
    if (share >= t.topCustomerSharePct) {
      add({
        code: 'customer_concentration',
        severity: 'warning',
        title: { ar: 'اعتماد كبير على عميل واحد', en: 'Heavy reliance on one customer' },
        message: {
          ar: `«${k.topCustomer.name}» وحده ${share}% من المبيعات.`,
          en: `"${k.topCustomer.name}" alone is ${share}% of sales.`,
        },
        action: { ar: 'وسّع قاعدة العملاء.', en: 'Broaden the customer base.' },
        target: 'customers',
        value: share,
      });
    }
  }
  if (k.lostCustomers.count > 0) {
    add({
      code: 'lost_customers',
      severity: 'warning',
      title: { ar: `${k.lostCustomers.count} عميلاً توقّف عن الشراء`, en: `${k.lostCustomers.count} customers stopped buying` },
      message: {
        ar: `اشتروا بـ${fmt(k.lostCustomers.prevSales)} في الفترة السابقة ولم يشتروا في الحالية.`,
        en: `They bought ${fmt(k.lostCustomers.prevSales)} in the previous period and nothing in this one.`,
      },
      action: { ar: 'اتصل بأكبرهم.', en: 'Call the largest ones.' },
      target: 'customers',
      value: k.lostCustomers.count,
    });
  }

  // returns
  const returnsRatio = sharePct(k.returns, k.sales);
  if (k.sales > 0 && returnsRatio >= t.returnsRatioPct) {
    add({
      code: 'high_returns',
      severity: 'warning',
      title: { ar: `المرتجعات ${returnsRatio}% من المبيعات`, en: `Returns are ${returnsRatio}% of sales` },
      message: {
        ar: `قيمتها ${fmt(k.returns)}${k.topReturnItem ? ` وأكثرها «${k.topReturnItem}»` : ''}.`,
        en: `${fmt(k.returns)} returned${k.topReturnItem ? `, mostly "${k.topReturnItem}"` : ''}.`,
      },
      action: {
        ar: 'نسبة مرتفعة تعني غالباً مشكلة جودة — افحص الصنف الأعلى.',
        en: 'A high ratio usually means a quality issue: check the top item.',
      },
      target: 'returns',
      value: returnsRatio,
    });
  }

  // expenses vs profit
  if (canSeeProfit && k.expenses > 0 && k.grossProfit > 0) {
    const ratio = r2((k.expenses / k.grossProfit) * 100);
    if (k.expenses >= k.grossProfit) {
      add({
        code: 'expenses_exceed_profit',
        severity: 'critical',
        title: { ar: 'المصروفات تلتهم الربح', en: 'Expenses exceed gross profit' },
        message: {
          ar: `المصروفات ${fmt(k.expenses)} والربح ${fmt(k.grossProfit)}.`,
          en: `Expenses ${fmt(k.expenses)} vs gross profit ${fmt(k.grossProfit)}.`,
        },
        action: { ar: 'راجع بنود المصروفات وابدأ بالأكبر.', en: 'Review expense accounts, largest first.' },
        value: ratio,
      });
    } else if (ratio >= t.expensesProfitWarnPct) {
      add({
        code: 'expenses_high',
        severity: 'warning',
        title: { ar: `المصروفات ${Math.round(ratio)}% من الربح`, en: `Expenses are ${Math.round(ratio)}% of gross profit` },
        message: {
          ar: `المصروفات ${fmt(k.expenses)} مقابل ربح ${fmt(k.grossProfit)}.`,
          en: `Expenses ${fmt(k.expenses)} vs gross profit ${fmt(k.grossProfit)}.`,
        },
        action: { ar: 'راجع البنود المتكرّرة.', en: 'Review recurring expenses.' },
        value: ratio,
      });
    }
  }

  // purchasing
  if (k.purchaseSuggestions.count > 0) {
    const withCost = canSeeProfit && k.purchaseSuggestions.expectedCost > 0;
    add({
      code: 'reorder_suggestions',
      severity: 'info',
      title: {
        ar: `${k.purchaseSuggestions.count} صنفاً يحتاج إعادة شراء`,
        en: `${k.purchaseSuggestions.count} items need reordering`,
      },
      message: withCost
        ? {
            ar: `التكلفة المتوقعة لتغطية ${t.purchaseCoverDays} يوماً: ${fmt(k.purchaseSuggestions.expectedCost)}.`,
            en: `Expected cost to cover ${t.purchaseCoverDays} days: ${fmt(k.purchaseSuggestions.expectedCost)}.`,
          }
        : { ar: 'بناءً على معدل البيع والرصيد الحالي.', en: 'Based on the sales rate and current stock.' },
      target: 'purchase-suggestions',
      value: k.purchaseSuggestions.count,
    });
  }

  // POS shifts
  if (k.worstCashDifference && Math.abs(k.worstCashDifference.amount) >= t.posCashDiffMin) {
    add({
      code: 'pos_cash_difference',
      severity: 'critical',
      title: { ar: 'فروق في عهدة الورديات', en: 'POS cash differences' },
      message: {
        ar: `أكبرها لدى «${k.worstCashDifference.userName}» بقيمة ${r2(k.worstCashDifference.amount)}.`,
        en: `Largest for "${k.worstCashDifference.userName}": ${r2(k.worstCashDifference.amount)}.`,
      },
      action: { ar: 'راجع جلسات نقطة البيع لهذا المستخدم.', en: "Review this user's POS sessions." },
      value: r2(k.worstCashDifference.amount),
    });
  }

  // treasury
  if (k.negativeTreasuries.length) {
    add({
      code: 'negative_treasury',
      severity: 'critical',
      title: { ar: 'خزينة برصيد سالب', en: 'Negative cash / bank balance' },
      message: {
        ar: `${k.negativeTreasuries.join('، ')} — غالباً خطأ تسجيل لا نقص حقيقي.`,
        en: `${k.negativeTreasuries.join(', ')}: usually a recording error rather than a real shortage.`,
      },
      action: { ar: 'راجع حركة الخزينة.', en: 'Review the cash book.' },
      value: k.negativeTreasuries.length,
    });
  }

  if (!out.length) {
    add({
      code: 'all_good',
      severity: 'good',
      title: { ar: 'لا توجد مؤشرات تحتاج انتباهاً', en: 'Nothing needs attention' },
      message: {
        ar: 'الأرقام في المدى المختار لا تُظهر مشكلة واضحة.',
        en: 'The figures for the selected range show no obvious issue.',
      },
      value: null,
    });
  }
  return sortInsights(out);
}

// ───────────────────────────── alerts ─────────────────────────────

export type DueBucket = 'overdue' | 'due_today' | 'due_soon';

/** Overdue (before today), due today, or due within `withinDays`; null otherwise. */
export function dueBucket(dueDate: string, today: string, withinDays: number): DueBucket | null {
  const d = daysBetween(today, dueDate);
  if (d < 0) return 'overdue';
  if (d === 0) return 'due_today';
  if (d <= withinDays) return 'due_soon';
  return null;
}

/** Notification de-duplication key: one notification per alert code and day. */
export function alertDedupKey(code: string, day: string): string {
  return `analytics:${code}:${day}`;
}
