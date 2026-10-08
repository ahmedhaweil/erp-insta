import { BadRequestException } from '@nestjs/common';
import { ProductionOrdersService } from './production-orders.service';
import { ProductionOrderStatus } from '../entities/production-order.entity';
import { BomLineType } from '../entities/bom-line.entity';

describe('ProductionOrdersService', () => {
  let service: ProductionOrdersService;
  let order: any;
  let orderRepo: Record<string, jest.Mock>;
  let lineRepo: Record<string, jest.Mock>;
  let recordRepo: Record<string, jest.Mock>;
  let scrapRepo: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let postedLines: any[];
  const costs: Record<string, number> = { compA: 10, compB: 4, labourSvc: 20, fg: 0, bp: 0 };

  const makeOrder = (overrides: any = {}) => ({
    id: 'mo-1',
    tenantId: 't1',
    orderNumber: 'MO-000001',
    bomId: 'bom-1',
    productId: 'fg',
    plannedQuantity: 10,
    producedQuantity: 0,
    status: ProductionOrderStatus.CONFIRMED,
    sourceWarehouseId: 'wh-src',
    destinationWarehouseId: 'wh-dst',
    labourCostPerUnit: 3,
    overheadCostPerUnit: 2,
    standardUnitCost: 0,
    actualComponentCost: 0,
    actualLabourCost: 0,
    actualOverheadCost: 0,
    scrapCost: 0,
    lines: [
      // 2 A and 5 B per finished unit
      { id: 'l1', type: BomLineType.COMPONENT, productId: 'compA', plannedQuantity: 20, doneQuantity: 0, reservedQuantity: 20, standardUnitCost: 10, actualCost: 0, costSharePercent: 0 },
      { id: 'l2', type: BomLineType.COMPONENT, productId: 'compB', plannedQuantity: 50, doneQuantity: 0, reservedQuantity: 0, standardUnitCost: 4, actualCost: 0, costSharePercent: 0 },
    ],
    ...overrides,
  });

  beforeEach(() => {
    order = makeOrder();
    postedLines = [];
    orderRepo = {
      findOne: jest.fn(async () => order),
      update: jest.fn(async (_w, patch) => Object.assign(order, patch)),
      save: jest.fn(async (o) => o),
      create: jest.fn((o) => o),
      find: jest.fn(),
      delete: jest.fn(),
    };
    lineRepo = { save: jest.fn(async (l) => l), create: jest.fn((l) => l), delete: jest.fn() };
    recordRepo = {
      create: jest.fn((r) => r),
      save: jest.fn(async (r) => Object.assign(r, { id: r.id ?? 'rec-1' })),
      find: jest.fn().mockResolvedValue([]),
    };
    scrapRepo = { create: jest.fn((s) => s), save: jest.fn(async (s) => ({ id: 'scrap-1', ...s })), find: jest.fn() };
    stockService = {
      isStockable: jest.fn(async (_t, pid) => pid !== 'labourSvc'),
      getUnitCost: jest.fn(async (_t, pid) => costs[pid] ?? 0),
      issue: jest.fn(async (_t, _u, req) => ({ unitCost: costs[req.productId], cost: costs[req.productId] * req.quantity })),
      receive: jest.fn(),
      reserve: jest.fn(async (_t, _p, _w, q) => q),
      release: jest.fn(),
      getStock: jest.fn().mockResolvedValue([]),
    };
    autoPosting = {
      preflight: jest.fn(),
      post: jest.fn(async (req) => {
        postedLines = req.buildLines({}, (k: string) => k);
        return null;
      }),
    };
    service = new ProductionOrdersService(
      orderRepo as any,
      lineRepo as any,
      recordRepo as any,
      scrapRepo as any,
      { findOne: jest.fn().mockResolvedValue({ id: 'wh' }) } as any,
      {} as any,
      stockService as any,
      autoPosting as any,
      { next: jest.fn().mockResolvedValue('SCRAP-000001') } as any,
    );
  });

  it('consumes components, receives finished goods at full cost and posts the manufacturing entry', async () => {
    const { record } = await service.produce('t1', 'u1', 'mo-1', { quantity: 10 });

    // components: 20 x 10 + 50 x 4 = 400; labour 30 + overhead 20 => 450 / 10 = 45
    expect(stockService.issue).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({
      productId: 'compA', quantity: 20, releaseReserved: 20, warehouseId: 'wh-src',
    }));
    expect(stockService.receive).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({
      productId: 'fg', quantity: 10, unitCost: 45, warehouseId: 'wh-dst',
    }));
    expect(record.unitCost).toBe(45);
    expect(postedLines).toEqual([
      expect.objectContaining({ accountId: 'inventoryAccountId', debit: 450 }),
      expect.objectContaining({ accountId: 'inventoryAccountId', credit: 400 }),
      expect.objectContaining({ accountId: 'manufacturingOverheadAccountId', credit: 50 }),
    ]);
    expect(autoPosting.preflight).toHaveBeenCalledWith('t1', expect.any(String), [
      'inventoryAccountId',
      'manufacturingOverheadAccountId',
    ]);
    expect(order.status).toBe(ProductionOrderStatus.DONE);
    expect(order.producedQuantity).toBe(10);
  });

  it('allows partial production pro rata and keeps the order in progress', async () => {
    await service.produce('t1', 'u1', 'mo-1', { quantity: 4 });
    expect(stockService.issue).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ productId: 'compA', quantity: 8, releaseReserved: 8 }));
    expect(stockService.issue).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ productId: 'compB', quantity: 20 }));
    expect(order.status).toBe(ProductionOrderStatus.IN_PROGRESS);
    expect(order.producedQuantity).toBe(4);
    expect(order.lines[0].reservedQuantity).toBe(12);
    expect(stockService.release).not.toHaveBeenCalled();
  });

  it('records actual consumption that differs from the BOM (variance) in the unit cost', async () => {
    await service.produce('t1', 'u1', 'mo-1', {
      quantity: 10,
      consumption: [{ productId: 'compB', quantity: 55 }],
    });
    // 200 + 55 x 4 = 420 + 50 = 470 / 10
    expect(stockService.receive).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ unitCost: 47 }));
    expect(order.lines[1].doneQuantity).toBe(55);

    const report = await service.costReport('t1', 'mo-1');
    const b = report.components.find((c: any) => c.productId === 'compB')!;
    expect(b.standardQuantity).toBe(50);
    expect(b.quantityVariance).toBe(5);
    expect(b.usageVariance).toBe(20);
    expect(report.actual.total).toBe(470);
    expect(report.standard.total).toBe(450);
  });

  it('rejects consumption of products that are not on the order', async () => {
    await expect(
      service.produce('t1', 'u1', 'mo-1', { quantity: 1, consumption: [{ productId: 'other', quantity: 1 }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(stockService.issue).not.toHaveBeenCalled();
  });

  it('assigns the by-product its cost share and the finished product the rest', async () => {
    order.lines.push({ id: 'l3', type: BomLineType.BY_PRODUCT, productId: 'bp', plannedQuantity: 5, doneQuantity: 0, reservedQuantity: 0, actualCost: 0, costSharePercent: 10 });
    await service.produce('t1', 'u1', 'mo-1', { quantity: 10 });
    // total 450: by-product 45 for 5 units (9 each), finished 405 / 10
    expect(stockService.receive).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ productId: 'bp', quantity: 5, unitCost: 9 }));
    expect(stockService.receive).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ productId: 'fg', unitCost: 40.5 }));
    expect(postedLines[0].debit).toBe(450);
  });

  it('absorbs service components through the overhead account', async () => {
    order.labourCostPerUnit = 0;
    order.overheadCostPerUnit = 0;
    order.lines.push({ id: 'l4', type: BomLineType.COMPONENT, productId: 'labourSvc', plannedQuantity: 1, doneQuantity: 0, reservedQuantity: 0, actualCost: 0, costSharePercent: 0 });
    await service.produce('t1', 'u1', 'mo-1', { quantity: 10 });
    expect(stockService.issue).toHaveBeenCalledTimes(2);
    expect(postedLines).toEqual([
      expect.objectContaining({ debit: 420 }),
      expect.objectContaining({ accountId: 'inventoryAccountId', credit: 400 }),
      expect.objectContaining({ accountId: 'manufacturingOverheadAccountId', credit: 20 }),
    ]);
  });

  it('finishing an under-produced order releases the remaining reservations', async () => {
    await service.produce('t1', 'u1', 'mo-1', { quantity: 4, finish: true });
    expect(stockService.release).toHaveBeenCalledWith('t1', 'compA', 'wh-src', 12);
    expect(order.status).toBe(ProductionOrderStatus.DONE);
  });

  it('refuses to produce on a draft order', async () => {
    order.status = ProductionOrderStatus.DRAFT;
    await expect(service.produce('t1', 'u1', 'mo-1', { quantity: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to confirm when components are short unless allowed', async () => {
    order = makeOrder({ status: ProductionOrderStatus.DRAFT });
    order.lines.forEach((l: any) => (l.reservedQuantity = 0));
    stockService.getStock.mockImplementation(async (_t: string, pid: string) =>
      pid === 'compA' ? [{ quantity: 25, reservedQty: 0 }] : [{ quantity: 30, reservedQty: 5 }],
    );
    await expect(service.confirm('t1', 'mo-1', {})).rejects.toBeInstanceOf(BadRequestException);

    const result = await service.confirm('t1', 'mo-1', { allowShortage: true, reserve: true });
    expect(result.availability).toEqual([
      { productId: 'compA', required: 20, available: 25, shortage: 0 },
      { productId: 'compB', required: 50, available: 25, shortage: 25 },
    ]);
    expect(stockService.reserve).toHaveBeenCalledWith('t1', 'compA', 'wh-src', 20);
    // standard: (200 + 200 + 50) / 10
    expect(order.standardUnitCost).toBe(45);
    expect(order.status).toBe(ProductionOrderStatus.CONFIRMED);
  });

  it('does not cancel an order with recorded production', async () => {
    order.producedQuantity = 2;
    await expect(service.cancel('t1', 'mo-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancelling releases reservations', async () => {
    const result = await service.cancel('t1', 'mo-1');
    expect(stockService.release).toHaveBeenCalledWith('t1', 'compA', 'wh-src', 20);
    expect(result.status).toBe(ProductionOrderStatus.CANCELLED);
  });

  it('scraps at average cost, consuming the order reservation and posting the loss', async () => {
    const scrap = await service.scrap('t1', 'u1', { productionOrderId: 'mo-1', productId: 'compA', quantity: 3, reason: 'damaged' });
    expect(stockService.issue).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ productId: 'compA', quantity: 3, releaseReserved: 3, warehouseId: 'wh-src' }));
    expect(scrap.cost).toBe(30);
    expect(order.lines[0].reservedQuantity).toBe(17);
    expect(order.scrapCost).toBe(30);
    expect(postedLines).toEqual([
      { accountId: 'stockAdjustmentAccountId', debit: 30 },
      { accountId: 'inventoryAccountId', credit: 30 },
    ]);
  });
});
