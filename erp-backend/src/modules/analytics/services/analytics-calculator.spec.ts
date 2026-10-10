import {
  DEFAULT_INSIGHT_THRESHOLDS,
  InsightInput,
  ItemPerformance,
  buildInsights,
  changePct,
  classifyItems,
  dailyRate,
  daysCover,
  dueBucket,
  isOverstock,
  isSlowMoving,
  lowStockStatus,
  median,
  resolvePeriod,
  stripProfit,
  suggestedPurchaseQty,
} from './analytics-calculator';

describe('analytics calculator', () => {
  describe('resolvePeriod', () => {
    it('defaults to first of month → today with an equal-length previous period', () => {
      expect(resolvePeriod(undefined, undefined, '2026-10-09')).toEqual({
        from: '2026-10-01',
        to: '2026-10-09',
        days: 9,
        prevFrom: '2026-09-22',
        prevTo: '2026-09-30',
      });
    });
    it('handles explicit ranges across months', () => {
      const p = resolvePeriod('2026-03-01', '2026-03-31', '2026-10-09');
      expect(p.days).toBe(31);
      expect(p.prevTo).toBe('2026-02-28');
      expect(p.prevFrom).toBe('2026-01-29');
    });
    it('rejects from after to', () => {
      expect(() => resolvePeriod('2026-05-02', '2026-05-01', '2026-10-09')).toThrow();
    });
  });

  it('median averages the two middle values (Instasoft took the upper one)', () => {
    expect(median([])).toBe(0);
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it('changePct is 0 when the previous value is 0', () => {
    expect(changePct(100, 0)).toBe(0);
    expect(changePct(90, 100)).toBe(-10);
    expect(changePct(-50, -100)).toBe(50);
  });

  describe('stock rules', () => {
    it('daily rate and days of cover', () => {
      expect(dailyRate(30, 10)).toBe(3);
      expect(dailyRate(0, 10)).toBe(0);
      expect(daysCover(12, 3)).toBe(4);
      expect(daysCover(12, 0)).toBeNull();
    });
    it('low-stock status', () => {
      expect(lowStockStatus(0, 5, null, 14)).toBe('out_of_stock');
      expect(lowStockStatus(-2, 0, null, 14)).toBe('out_of_stock');
      expect(lowStockStatus(5, 5, 100, 14)).toBe('below_minimum');
      expect(lowStockStatus(20, 5, 14, 14)).toBe('running_out');
      expect(lowStockStatus(20, 5, 15, 14)).toBeNull();
      expect(lowStockStatus(20, 0, null, 14)).toBeNull();
    });
    it('overstock needs stock, sales and a long cover', () => {
      expect(isOverstock(100, 10, 90, 90)).toBe(true);
      expect(isOverstock(100, 0, null, 90)).toBe(false);
      expect(isOverstock(100, 10, 89, 90)).toBe(false);
    });
    it('slow moving: never sold or past the threshold', () => {
      expect(isSlowMoving(5, null, 30)).toBe(true);
      expect(isSlowMoving(5, 30, 30)).toBe(true);
      expect(isSlowMoving(5, 29, 30)).toBe(false);
      expect(isSlowMoving(0, null, 30)).toBe(false);
    });
    it('purchase suggestion deducts on-hand and incoming and rounds up', () => {
      // 3/day × 30 = 90 − (20 + 10) = 60
      expect(suggestedPurchaseQty(3, 30, 20, 10)).toBe(60);
      expect(suggestedPurchaseQty(0.7, 30, 5, 0)).toBe(16); // 21 − 5
      expect(suggestedPurchaseQty(0.5, 10, 2.5, 0)).toBe(3); // ceil(2.5)
      expect(suggestedPurchaseQty(1, 30, 40, 0)).toBe(0);
      expect(suggestedPurchaseQty(1, 30, -10, 0)).toBe(30); // negative stock counts as 0
      expect(suggestedPurchaseQty(0.1, 30, 0, 0)).toBe(3); // no float overshoot
    });
  });

  describe('classifyItems', () => {
    const item = (key: string, sales: number, margin: number, prevSales = 0, profitChange = 0): ItemPerformance => ({
      key,
      code: key,
      name: key,
      categoryId: null,
      categoryName: '',
      quantity: 1,
      sales,
      cost: sales * (1 - margin / 100),
      profit: (sales * margin) / 100,
      margin,
      prevQuantity: 0,
      prevSales,
      prevProfit: 0,
      salesChangePct: changePct(sales, prevSales),
      profitChange,
    });
    const items = [
      item('A', 1000, 10, 2000, -50),
      item('B', 800, 40, 400),
      item('C', 100, 50),
      item('D', 50, 5),
      item('E', 0, 0, 300, -30),
    ];
    const q = classifyItems(items);

    it('uses the median of current sales and the mean margin', () => {
      expect(q.medianSales).toBe(450); // (100 + 800) / 2
      expect(q.averageMargin).toBe(26.25);
    });
    it('splits the quadrants', () => {
      expect(q.highSalesLowMargin.map((i) => i.key)).toEqual(['A']);
      expect(q.highMarginLowSales.map((i) => i.key)).toEqual(['C']);
    });
    it('ranks top selling / profit and lists decliners and profit losers', () => {
      expect(q.topSelling.map((i) => i.key)).toEqual(['A', 'B', 'C', 'D']);
      expect(q.topProfit[0].key).toBe('B');
      expect(q.declining.map((i) => i.key)).toEqual(['E', 'A']); // E: -100%
      expect(q.profitLosers.map((i) => i.key)).toEqual(['A', 'E']);
    });
  });

  it('stripProfit removes cost / profit / margin / stock value fields recursively', () => {
    expect(
      stripProfit({ sales: 1, cost: 2, rows: [{ name: 'x', margin: 3, stockValue: 4, onHand: 5 }] }),
    ).toEqual({ sales: 1, rows: [{ name: 'x', onHand: 5 }] });
  });

  describe('buildInsights', () => {
    const base: InsightInput = {
      sales: 1000,
      returns: 0,
      prevReturns: 0,
      netSales: 1000,
      prevNetSales: 1000,
      grossProfit: 300,
      prevGrossProfit: 300,
      margin: 30,
      prevMargin: 30,
      expenses: 0,
      stockValue: 10000,
      outOfStockCount: 0,
      lowStockCount: 0,
      slowCount: 0,
      slowValue: 0,
      overstockCount: 0,
      highMarginLowSales: { count: 0 },
      highSalesLowMargin: { count: 0 },
      lostCustomers: { count: 0, prevSales: 0 },
      purchaseSuggestions: { count: 0, expectedCost: 0 },
      negativeTreasuries: [],
    };
    const codes = (k: Partial<InsightInput>, canSee = true) =>
      buildInsights({ ...base, ...k }, DEFAULT_INSIGHT_THRESHOLDS, canSee).map((i) => `${i.code}:${i.severity}`);

    it('returns one good card when nothing fires', () => {
      expect(codes({})).toEqual(['all_good:good']);
    });
    it('sales trend thresholds', () => {
      expect(codes({ netSales: 950 })).toContain('sales_down:warning');
      expect(codes({ netSales: 960 })).not.toContain('sales_down:warning');
      expect(codes({ netSales: 1050 })).toContain('sales_up:good');
    });
    it('profit drop is critical with causes', () => {
      const res = buildInsights(
        { ...base, netSales: 900, grossProfit: 200, margin: 22.2, returns: 50 },
        DEFAULT_INSIGHT_THRESHOLDS,
      );
      const card = res.find((i) => i.code === 'profit_down')!;
      expect(card.severity).toBe('critical');
      expect(card.message.en).toContain('sales down 10%');
      expect(card.message.en).toContain('margin down');
      expect(card.message.en).toContain('more returns');
      expect(res.some((i) => i.code === 'margin_down')).toBe(true);
      expect(res[0].severity).toBe('critical');
    });
    it('profit rules are hidden without the profit permission', () => {
      const res = codes({ grossProfit: 100, margin: 10, expenses: 500, highMarginLowSales: { count: 2 } }, false);
      expect(res.some((c) => /profit|margin|expenses/.test(c))).toBe(false);
    });
    it('stock cards', () => {
      expect(codes({ outOfStockCount: 2, lowStockCount: 3, overstockCount: 1 })).toEqual([
        'out_of_stock:critical',
        'low_stock:warning',
        'overstock:info',
      ]);
      expect(codes({ slowCount: 4, slowValue: 2000 })).toContain('slow_stock:warning');
      expect(codes({ slowCount: 4, slowValue: 3000 })).toContain('slow_stock:critical');
    });
    it('concentration, lost customers, returns', () => {
      expect(codes({ topItem: { name: 'X', sales: 300 } })).toContain('item_concentration:warning');
      expect(codes({ topItem: { name: 'X', sales: 290 } })).not.toContain('item_concentration:warning');
      expect(codes({ topCustomer: { name: 'Y', sales: 250 } })).toContain('customer_concentration:warning');
      expect(codes({ lostCustomers: { count: 2, prevSales: 500 } })).toContain('lost_customers:warning');
      expect(codes({ returns: 50 })).toContain('high_returns:warning');
      expect(codes({ returns: 49 })).not.toContain('high_returns:warning');
    });
    it('expenses vs profit', () => {
      expect(codes({ expenses: 300 })).toContain('expenses_exceed_profit:critical');
      expect(codes({ expenses: 180 })).toContain('expenses_high:warning');
      expect(codes({ expenses: 170 })).toEqual(['all_good:good']);
    });
    it('POS cash difference and negative treasury are critical; suggestions info', () => {
      expect(codes({ worstCashDifference: { userName: 'u', amount: 0.5 } })).toEqual(['all_good:good']);
      expect(codes({ worstCashDifference: { userName: 'u', amount: -1 } })).toContain('pos_cash_difference:critical');
      expect(codes({ negativeTreasuries: ['C1 Cash'] })).toContain('negative_treasury:critical');
      expect(codes({ purchaseSuggestions: { count: 3, expectedCost: 900 } })).toContain('reorder_suggestions:info');
    });
    it('respects tenant thresholds', () => {
      const res = buildInsights({ ...base, netSales: 950 }, { ...DEFAULT_INSIGHT_THRESHOLDS, salesDropPct: 10 });
      expect(res.map((i) => i.code)).toEqual(['all_good']);
    });
    it('sorts critical → warning → info → good', () => {
      const res = codes({ netSales: 1100, grossProfit: 330, overstockCount: 1, outOfStockCount: 1, lowStockCount: 1 });
      expect(res).toEqual(['out_of_stock:critical', 'low_stock:warning', 'overstock:info', 'sales_up:good']);
    });
  });

  it('dueBucket classifies due dates', () => {
    expect(dueBucket('2026-10-08', '2026-10-09', 7)).toBe('overdue');
    expect(dueBucket('2026-10-09', '2026-10-09', 7)).toBe('due_today');
    expect(dueBucket('2026-10-16', '2026-10-09', 7)).toBe('due_soon');
    expect(dueBucket('2026-10-17', '2026-10-09', 7)).toBeNull();
  });
});
