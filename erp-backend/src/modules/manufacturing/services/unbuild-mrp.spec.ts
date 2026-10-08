import { ConflictException } from '@nestjs/common';
import { ProductionOrdersService } from './production-orders.service';
import { BomsService } from './boms.service';
import { ProductionOrderStatus } from '../entities/production-order.entity';
import { BomLineType } from '../entities/bom-line.entity';

describe('ProductionOrdersService.reverseRun (un-build)', () => {
  let order: any;
  let record: any;
  let stockService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let recordRepo: Record<string, jest.Mock>;
  let service: ProductionOrdersService;
  let posted: any[];

  beforeEach(() => {
    order = {
      id: 'mo-1',
      orderNumber: 'MO-1',
      productId: 'fg',
      status: ProductionOrderStatus.DONE,
      plannedQuantity: 10,
      producedQuantity: 10,
      sourceWarehouseId: 'src',
      destinationWarehouseId: 'dst',
      actualComponentCost: 400,
      actualLabourCost: 30,
      actualOverheadCost: 20,
      lines: [
        { productId: 'compA', type: BomLineType.COMPONENT, doneQuantity: 20, actualCost: 200 },
        { productId: 'compB', type: BomLineType.COMPONENT, doneQuantity: 50, actualCost: 200 },
      ],
    };
    record = {
      id: 'rec-1',
      orderId: 'mo-1',
      quantity: 10,
      componentCost: 400,
      labourCost: 30,
      overheadCost: 20,
      byProductCost: 0,
      unitCost: 45,
      outputLots: [{ lotNumber: 'MO-1', quantity: 10, expiryDate: null }],
      moves: [
        { productId: 'compA', type: 'component', quantity: 20, unitCost: 10, cost: 200, lots: [{ lotNumber: 'A1', quantity: 20, expiryDate: null }] },
        { productId: 'compB', type: 'component', quantity: 50, unitCost: 4, cost: 200, lots: [] },
      ],
      reversedAt: null,
    };
    posted = [];
    stockService = {
      isStockable: jest.fn(async () => true),
      availableQuantity: jest.fn(async () => ({ onHand: 10, reserved: 0, available: 10 })),
      issue: jest.fn(async (_t, _u, req) => ({ unitCost: 46, cost: 46 * req.quantity, lots: [] })),
      receive: jest.fn(),
    };
    autoPosting = {
      preflight: jest.fn(),
      reverseSource: jest.fn(),
      post: jest.fn(async (req) => posted.push(req.buildLines({ stockAdjustmentAccountId: 'adj' }, (k: string) => k))),
    };
    recordRepo = { findOne: jest.fn(async () => record), save: jest.fn(async (r) => r) };
    service = new ProductionOrdersService(
      { findOne: jest.fn(async () => order), update: jest.fn(async (_w, p) => Object.assign(order, p)) } as any,
      { save: jest.fn(async (l) => l) } as any,
      recordRepo as any,
      {} as any,
      {} as any,
      {} as any,
      stockService as any,
      autoPosting as any,
      {} as any,
    );
  });

  it('takes the finished lots out, returns components with their lots and reverses the entry', async () => {
    await service.reverseRun('t1', 'u1', 'mo-1', 'rec-1');
    expect(stockService.issue).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ productId: 'fg', warehouseId: 'dst', quantity: 10, lots: record.outputLots }),
      { includeExpiredLots: true },
    );
    expect(stockService.receive).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ productId: 'compA', warehouseId: 'src', quantity: 20, unitCost: 10, lots: [{ lotNumber: 'A1', quantity: 20, expiryDate: null }] }),
    );
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'production_order', 'rec-1', expect.any(String));
    // 460 taken out at current average vs 450 recorded: 10 to stock adjustment
    expect(posted[0]).toEqual([
      { accountId: 'adj', debit: 10 },
      { accountId: 'inventoryAccountId', credit: 10 },
    ]);
    expect(order.producedQuantity).toBe(0);
    expect(order.status).toBe(ProductionOrderStatus.CONFIRMED);
    expect(order.lines[0].doneQuantity).toBe(0);
    expect(record.reversedAt).toBeInstanceOf(Date);
  });

  it('refuses when the produced goods were already consumed', async () => {
    stockService.availableQuantity.mockResolvedValue({ onHand: 4, reserved: 0, available: 4 });
    await expect(service.reverseRun('t1', 'u1', 'mo-1', 'rec-1')).rejects.toThrow(ConflictException);
    expect(stockService.issue).not.toHaveBeenCalled();
  });

  it('refuses to reverse a run twice', async () => {
    record.reversedAt = new Date();
    await expect(service.reverseRun('t1', 'u1', 'mo-1', 'rec-1')).rejects.toThrow(/already reversed/);
  });
});

describe('BomsService.explode MRP netting', () => {
  it('uses available sub-assembly stock before exploding the remainder', async () => {
    const boms: Record<string, any> = {
      sub: { id: 'b-sub', productId: 'sub', outputQuantity: 1, lines: [{ type: BomLineType.COMPONENT, productId: 'raw', quantity: 2 }] },
    };
    const service = new BomsService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(service, 'getActiveBom').mockImplementation(async (_t, pid) => boms[pid] ?? null);
    const top = { id: 'b-top', productId: 'fg', outputQuantity: 1, lines: [{ type: BomLineType.COMPONENT, productId: 'sub', quantity: 1 }] };

    const netted = await service.explode('t1', top as any, 10, true, { availableStock: async () => 4 });
    expect(netted.fromStock).toEqual([{ productId: 'sub', quantity: 4, level: 1 }]);
    expect(netted.subAssemblies).toEqual([{ productId: 'sub', quantity: 6, level: 1 }]);
    expect(netted.components).toEqual([{ productId: 'raw', quantity: 12, level: 2 }]);

    const plain = await service.explode('t1', top as any, 10, true);
    expect(plain.components).toEqual([{ productId: 'raw', quantity: 20, level: 2 }]);
  });
});
