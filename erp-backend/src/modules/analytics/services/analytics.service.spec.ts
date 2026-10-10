import { SalesFact } from '@modules/reports/services/sales-analysis.service';
import { AnalyticsService, periodTotals } from './analytics.service';
import { DEFAULT_ANALYTICS_SETTINGS } from './analytics-settings.service';

const fact = (f: Partial<SalesFact>): SalesFact => ({
  source: 'invoice',
  docId: 'd1',
  number: 'INV-1',
  date: '2026-10-02',
  partnerId: 'c1',
  productId: 'p1',
  categoryId: null,
  branchId: null,
  userId: 'u1',
  quantity: 1,
  net: 100,
  tax: 0,
  cost: 60,
  costSource: 'stock_moves',
  ...f,
});

describe('periodTotals', () => {
  it('separates returns by document and nets them', () => {
    const t = periodTotals([
      fact({ docId: 'd1', quantity: 2, net: 200, cost: 120 }),
      fact({ docId: 'd1', productId: 'p2', quantity: 1, net: 100, cost: 50 }),
      fact({ source: 'pos', docId: 'o1', quantity: 1, net: 100, cost: 60 }),
      fact({ docId: 'cn1', quantity: -1, net: -100, cost: -60 }),
    ]);
    expect(t).toEqual({
      sales: 400,
      returns: 100,
      netSales: 300,
      cost: 170,
      grossProfit: 130,
      margin: 43.33,
      qtySold: 3,
      distinctItems: 2,
      invoiceCount: 2,
      averageInvoice: 200,
    });
  });

  it('is all zeros without facts', () => {
    expect(periodTotals([]).margin).toBe(0);
  });
});

describe('AnalyticsService', () => {
  const tenantId = 't1';
  let repo: { query: jest.Mock };
  let sales: { salesFacts: jest.Mock; names: jest.Mock; purchaseAnalysis: jest.Mock };
  let rbac: { hasPermission: jest.Mock };
  let service: AnalyticsService;

  beforeEach(() => {
    repo = { query: jest.fn().mockResolvedValue([]) };
    sales = {
      salesFacts: jest.fn().mockResolvedValue([]),
      names: jest.fn().mockResolvedValue({
        products: new Map([
          ['p1', { code: 'P1', name: 'Item 1', categoryId: null }],
          ['p2', { code: 'P2', name: 'Item 2', categoryId: null }],
        ]),
        partners: new Map(),
        categories: new Map(),
        branches: new Map(),
        users: new Map(),
      }),
      purchaseAnalysis: jest.fn().mockResolvedValue({ totals: { net: 0 } }),
    };
    rbac = { hasPermission: jest.fn().mockResolvedValue(true) };
    const settings = { get: jest.fn().mockResolvedValue({ ...DEFAULT_ANALYTICS_SETTINGS }) };
    service = new AnalyticsService(repo as any, sales as any, settings as any, rbac as any);
  });

  const stockRows = [
    // sold 30 in 10 days = 3/day, 12 on hand = 4 days cover
    { id: 'p1', code: 'P1', name_en: 'Item 1', cost_price: '10', reorder_level: '0', on_hand: '12', stock_rows: '1' },
    // never sold, in stock
    { id: 'p2', code: 'P2', name_en: 'Item 2', cost_price: '5', reorder_level: '0', on_hand: '100', stock_rows: '1' },
    // stocked earlier, now empty
    { id: 'p3', code: 'P3', name_en: 'Item 3', cost_price: '1', reorder_level: '0', on_hand: '0', stock_rows: '1' },
  ];

  const ctx = async () => {
    repo.query.mockImplementation(async (sql: string) => {
      if (/FROM products pr/.test(sql)) return stockRows;
      if (/FROM purchase_order_lines/.test(sql)) return [{ productId: 'p1', qty: '20' }];
      return [];
    });
    sales.salesFacts.mockImplementation(async (_t: string, q: { from: string }) =>
      q.from === '2026-10-01' ? [fact({ productId: 'p1', quantity: 30, net: 300, cost: 300 })] : [],
    );
    return service.context(tenantId, { from: '2026-10-01', to: '2026-10-10' } as any);
  };

  it('computes low stock, slow-moving and purchase suggestions from the same facts', async () => {
    const c = await ctx();
    const low = await service.lowStock(c);
    expect(low.rows.map((r) => [r.productId, r.status, r.daysCover])).toEqual([
      ['p3', 'out_of_stock', null],
      ['p1', 'running_out', 4],
    ]);
    const slow = await service.slowMoving(c);
    expect(slow.rows.map((r) => r.productId)).toEqual(['p2', 'p1']); // p1 never in lastSales mock
    expect(slow.slowValue).toBe(620);
    const sug = await service.purchaseSuggestions(c);
    // 3/day × 30 − (12 + 20) = 58
    expect(sug.rows).toEqual([expect.objectContaining({ productId: 'p1', suggestedQty: 58, expectedCost: 580 })]);
  });

  it('kpi reports change % against the previous period and stock figures', async () => {
    const c = await ctx();
    const k: any = await service.kpi(c);
    expect(k.netSales).toBe(300);
    expect(k.prevNetSales).toBe(0);
    expect(k.netSalesChangePct).toBe(0);
    expect(k.stockValue).toBe(620);
    expect(k.outOfStockCount).toBe(1);
    expect(k.period.prevFrom).toBe('2026-09-21');
  });

  it('strips profit fields without analytics/profit/read', async () => {
    rbac.hasPermission.mockResolvedValue(false);
    const data = await service.visible(tenantId, 'u1', { sales: 1, grossProfit: 2, rows: [{ stockValue: 3, onHand: 1 }] });
    expect(data).toEqual({ sales: 1, rows: [{ onHand: 1 }] });
  });
});
