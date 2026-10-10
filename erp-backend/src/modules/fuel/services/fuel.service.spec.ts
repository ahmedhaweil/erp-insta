import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { FuelService } from './fuel.service';
import { stripCosts } from '../controllers/fuel.controller';

const repo = () => ({
  find: jest.fn(async (): Promise<any[]> => []),
  findOne: jest.fn<Promise<any>, any[]>(),
  save: jest.fn(async (x: any) => (Array.isArray(x) ? x : { id: x.id ?? 'saved-id', ...x })),
  create: jest.fn((x: any) => x),
  count: jest.fn(async () => 0),
});

describe('FuelService', () => {
  let tanks: ReturnType<typeof repo>;
  let pumps: ReturnType<typeof repo>;
  let nozzles: ReturnType<typeof repo>;
  let shifts: ReturnType<typeof repo>;
  let lines: ReturnType<typeof repo>;
  let credits: ReturnType<typeof repo>;
  let dips: ReturnType<typeof repo>;
  let meters: ReturnType<typeof repo>;
  let products: ReturnType<typeof repo>;
  let movements: ReturnType<typeof repo>;
  let stock: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let accountingSettings: Record<string, jest.Mock>;
  let invoices: Record<string, jest.Mock>;
  let service: FuelService;

  const tank = { id: 'tk1', tenantId: 't1', nameAr: 'خزان 92', fuelProductId: 'p92', warehouseId: 'w1', capacity: 20000, minLevel: 3000 };
  const product = { id: 'p92', sellPrice: 11.4, salesTaxRate: 14 };

  beforeEach(() => {
    tanks = repo();
    pumps = repo();
    nozzles = repo();
    shifts = repo();
    lines = repo();
    credits = repo();
    dips = repo();
    meters = repo();
    products = repo();
    movements = repo();
    stock = {
      issue: jest.fn(async () => ({ unitCost: 8.5, cost: 0, lots: [] })),
      adjust: jest.fn(),
      getStock: jest.fn(async () => [{ quantity: 5000 }]),
    };
    autoPosting = { post: jest.fn(), preflight: jest.fn() };
    accountingSettings = { find: jest.fn(async () => ({ cashOverShortAccountId: 'os' })) };
    invoices = {
      create: jest.fn(async () => ({ id: 'inv1' })),
      post: jest.fn(async () => ({ id: 'inv1', subtotal: 500, taxAmount: 70, totalAmount: 570 })),
    };
    service = new FuelService(
      tanks as any,
      pumps as any,
      nozzles as any,
      shifts as any,
      lines as any,
      credits as any,
      dips as any,
      meters as any,
      products as any,
      movements as any,
      { next: jest.fn(async () => 'FSH-000001') } as any,
      stock as any,
      autoPosting as any,
      accountingSettings as any,
      invoices as any,
    );
  });

  describe('opening', () => {
    it('refuses a second open shift for the same attendant', async () => {
      shifts.findOne.mockResolvedValueOnce({ id: 's0', shiftNumber: 'FSH-000009' });
      await expect(service.openShift('t1', 'u1', {})).rejects.toThrow(ConflictException);
    });

    it('refuses a nozzle already in another open shift', async () => {
      shifts.findOne.mockResolvedValueOnce(null);
      shifts.find.mockResolvedValueOnce([{ id: 'other' }]);
      lines.find.mockResolvedValueOnce([{ nozzleId: 'n1' }]);
      nozzles.find.mockResolvedValueOnce([{ id: 'n1', nameAr: 'مسدس 1', tankId: 'tk1' }]);
      await expect(service.openShift('t1', 'u1', { nozzleIds: ['n1'] })).rejects.toThrow(/already in an open shift/);
    });

    it('records opening meters and the pump price (override first, else product price)', async () => {
      shifts.findOne.mockResolvedValueOnce(null).mockResolvedValue({ id: 'saved-id', lines: [], credits: [] });
      nozzles.find.mockResolvedValueOnce([
        { id: 'n1', tankId: 'tk1', currentReading: 1000, priceOverride: null },
        { id: 'n2', tankId: 'tk1', currentReading: 2000, priceOverride: 11 },
      ]);
      tanks.find.mockResolvedValueOnce([tank]);
      products.find.mockResolvedValueOnce([product]);
      await service.openShift('t1', 'u1', {});
      const saved = lines.save.mock.calls[0][0];
      expect(saved).toEqual([
        expect.objectContaining({ nozzleId: 'n1', openingReading: 1000, unitPrice: 11.4, taxRate: 14, productId: 'p92' }),
        expect.objectContaining({ nozzleId: 'n2', openingReading: 2000, unitPrice: 11, taxRate: 14 }),
      ]);
    });
  });

  describe('closing', () => {
    const openShift = () => ({ id: 's1', tenantId: 't1', shiftNumber: 'FSH-000001', userId: 'u1', status: 'open' });
    const shiftLines = () => [
      { id: 'l1', shiftId: 's1', nozzleId: 'n1', tankId: 'tk1', productId: 'p92', openingReading: 1000, unitPrice: 11.4, taxRate: 14 },
    ];

    beforeEach(() => {
      shifts.findOne.mockResolvedValueOnce(openShift()).mockResolvedValue({ id: 's1', lines: [], credits: [] });
      lines.find.mockResolvedValue(shiftLines());
      tanks.find.mockResolvedValue([tank]);
      nozzles.find.mockResolvedValue([{ id: 'n1', currentReading: 1000 }]);
    });

    it('issues the liters, invoices credit customers and posts a balanced shift entry', async () => {
      await service.closeShift('t1', { userId: 'u1' }, 's1', {
        readings: [{ nozzleId: 'n1', closingReading: 1500, couponAmount: 200 }],
        cardAmount: 1000,
        creditSales: [{ customerId: 'c1', amount: 570 }],
        cashCounted: 3920,
      });

      expect(stock.issue).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ productId: 'p92', warehouseId: 'w1', quantity: 500, referenceType: 'fuel_shift' }));
      // credit customer: posted invoice of 50 L at the pump price, VAT included
      const inv = invoices.create.mock.calls[0];
      expect(inv[2]).toEqual(expect.objectContaining({ customerId: 'c1', pricesIncludeTax: true }));
      expect(inv[2].lines).toEqual([{ productId: 'p92', quantity: 50, unitPrice: 11.4, taxRate: 14 }]);
      expect(invoices.post).toHaveBeenCalledWith('t1', 'u1', 'inv1');

      const posting = autoPosting.post.mock.calls[0][0];
      const entry = posting.buildLines({}, (k: string) => k);
      expect(entry).toEqual([
        { accountId: 'cashAccountId', debit: 3920 },
        { accountId: 'cashOverShortAccountId', debit: 10, description: 'Cash shortage' },
        { accountId: 'bankAccountId', debit: 1000 },
        { accountId: 'fuelCouponAccountId', debit: 200 },
        { accountId: 'salesAccountId', credit: 4500 },
        { accountId: 'outputTaxAccountId', credit: 630 },
        { accountId: 'cogsAccountId', debit: 4250 },
        { accountId: 'inventoryAccountId', credit: 4250 },
      ]);
      const total = entry.reduce((s: number, l: any) => s + (l.debit ?? 0) - (l.credit ?? 0), 0);
      expect(Math.abs(total)).toBeLessThan(0.0001);

      const closed = shifts.save.mock.calls.at(-1)![0];
      expect(closed).toEqual(
        expect.objectContaining({
          status: 'closed',
          totalLiters: 500,
          totalAmount: 5700,
          couponAmount: 200,
          creditAmount: 570,
          cashExpected: 3930,
          cashDifference: -10,
          totalCost: 4250,
          totalMargin: 750,
        }),
      );
      expect(nozzles.save.mock.calls[0][0][0].currentReading).toBe(1500);
      expect(credits.save.mock.calls[0][0][0]).toEqual(expect.objectContaining({ salesInvoiceId: 'inv1', amount: 570 }));
    });

    it('refuses a closing meter below the opening one', async () => {
      await expect(
        service.closeShift('t1', { userId: 'u1' }, 's1', { readings: [{ nozzleId: 'n1', closingReading: 900 }] }),
      ).rejects.toThrow(BadRequestException);
      expect(stock.issue).not.toHaveBeenCalled();
    });

    it('requires a reading for every nozzle of the shift', async () => {
      lines.find.mockResolvedValue([...shiftLines(), { ...shiftLines()[0], id: 'l2', nozzleId: 'n2' }]);
      await expect(
        service.closeShift('t1', { userId: 'u1' }, 's1', { readings: [{ nozzleId: 'n1', closingReading: 1100 }] }),
      ).rejects.toThrow(/missing/);
    });

    it("refuses closing another attendant's shift without the manage permission", async () => {
      await expect(
        service.closeShift('t1', { userId: 'other' }, 's1', { readings: [{ nozzleId: 'n1', closingReading: 1100 }] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses card + coupons above the sales before touching stock', async () => {
      await expect(
        service.closeShift('t1', { userId: 'u1' }, 's1', {
          readings: [{ nozzleId: 'n1', closingReading: 1010 }],
          cardAmount: 500,
        }),
      ).rejects.toThrow(/exceed/);
      expect(stock.issue).not.toHaveBeenCalled();
    });
  });

  describe('tank control', () => {
    it('records a dip variance and books it as a stock adjustment', async () => {
      tanks.findOne.mockResolvedValue(tank);
      dips.save.mockImplementation(async (x: any) => ({ id: 'd1', ...x }));
      const dip = await service.recordDip('t1', 'u1', 'tk1', { measuredQty: 4950, adjust: true, reason: 'evaporation' });
      expect(dip.variance).toBe(-50);
      expect(stock.adjust).toHaveBeenCalledWith(
        't1',
        'u1',
        expect.objectContaining({ productId: 'p92', warehouseId: 'w1', quantity: -50 }),
        { referenceType: 'fuel_tank_dip', referenceId: 'd1' },
      );
      expect(dip.adjusted).toBe(true);
    });

    it('lists tanks at or below their low level', async () => {
      tanks.find.mockResolvedValue([tank, { ...tank, id: 'tk2', minLevel: null }]);
      stock.getStock.mockResolvedValue([{ quantity: 2500 }]);
      const alerts = await service.lowLevelAlerts('t1');
      expect(alerts).toEqual([expect.objectContaining({ tankId: 'tk1', bookQty: 2500, fillPercent: 12.5 })]);
    });

    it('refuses a meter adjustment while the nozzle is in an open shift, and audits it otherwise', async () => {
      nozzles.findOne.mockResolvedValue({ id: 'n1', currentReading: 1000 });
      shifts.find.mockResolvedValue([{ id: 's1' }]);
      lines.count.mockResolvedValueOnce(1);
      await expect(service.adjustMeter('t1', 'u1', 'n1', { newReading: 1200, reason: 'replaced' })).rejects.toThrow(ConflictException);

      lines.count.mockResolvedValueOnce(0);
      await service.adjustMeter('t1', 'u1', 'n1', { newReading: 1200, reason: 'replaced' });
      expect(meters.save.mock.calls[0][0]).toEqual(expect.objectContaining({ oldReading: 1000, newReading: 1200, userId: 'u1' }));
    });
  });

  it('hides cost and margin without the costs permission', () => {
    expect(stripCosts({ totalCost: 1, totalMargin: 2, lines: [{ liters: 5, cost: 3, margin: 1, unitCost: 2 }] })).toEqual({
      lines: [{ liters: 5 }],
    });
  });
});
