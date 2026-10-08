import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { StockCountsService } from './stock-counts.service';
import { StockCount, StockCountLine, StockCountStatus } from '../entities/stock-count.entity';
import { Product, TrackingType } from '../entities/product.entity';
import { Category } from '../entities/category.entity';
import { Stock } from '../entities/stock.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { StockService } from './stock.service';
import { LotsService } from './lots.service';
import { ProductsService } from './products.service';
import { SequenceService } from '@shared/services/sequence.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';

describe('StockCountsService', () => {
  let service: StockCountsService;
  let countRepo: Record<string, jest.Mock>;
  let lineRepo: Record<string, jest.Mock>;
  let productRepo: Record<string, jest.Mock>;
  let stockRepo: Record<string, jest.Mock>;
  let lotsService: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let stored: any;

  const plain = { id: 'p1', code: 'A', type: 'goods', costPrice: 10, trackingType: TrackingType.NONE };
  const tracked = { id: 'p2', code: 'B', type: 'goods', costPrice: 5, trackingType: TrackingType.LOT };

  beforeEach(async () => {
    stored = null;
    countRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (e) => {
        stored = { id: 'c1', ...(stored ?? {}), ...e, lines: e.lines ?? stored?.lines };
        stored.lines = (stored.lines ?? []).map((l: any, i: number) => ({ id: l.id ?? `line-${i}`, ...l }));
        return stored;
      }),
      findOne: jest.fn(async () => stored),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    };
    lineRepo = { save: jest.fn(async (e) => e), create: jest.fn((dto) => dto) };
    productRepo = { find: jest.fn().mockResolvedValue([plain, tracked]), findOne: jest.fn() };
    stockRepo = {
      find: jest.fn().mockResolvedValue([
        { productId: 'p1', quantity: '8' },
        { productId: 'p2', quantity: '10' },
      ]),
    };
    lotsService = {
      findWarehouseLots: jest.fn().mockResolvedValue([
        { productId: 'p2', lotNumber: 'L1', quantity: '6', expiryDate: '2030-01-01' },
      ]),
    };
    stockService = { adjust: jest.fn().mockResolvedValue({}) };
    autoPosting = { preflight: jest.fn(), post: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        StockCountsService,
        { provide: getRepositoryToken(StockCount), useValue: countRepo },
        { provide: getRepositoryToken(StockCountLine), useValue: lineRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(Category), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Stock), useValue: stockRepo },
        { provide: getRepositoryToken(Warehouse), useValue: { findOne: jest.fn().mockResolvedValue({ id: 'w1' }) } },
        { provide: StockService, useValue: stockService },
        { provide: LotsService, useValue: lotsService },
        { provide: ProductsService, useValue: { lookupBarcode: jest.fn(), toBaseQuantity: jest.fn() } },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue('CNT-000001') } },
        { provide: AutoPostingService, useValue: autoPosting },
      ],
    }).compile();
    service = module.get(StockCountsService);
  });

  it('snapshots system quantities per lot, with the untracked rest of tracked products', async () => {
    const count = await service.create('t1', 'u1', { warehouseId: 'w1' });
    const snapshot = count.lines.map((l) => [l.productId, l.lotNumber, l.systemQty]);
    expect(snapshot).toEqual(
      expect.arrayContaining([
        ['p1', null, 8],
        ['p2', 'L1', 6],
        ['p2', null, 4],
      ]),
    );
    expect(count.status).toBe(StockCountStatus.OPEN);
    expect(count.summary.uncountedLines).toBe(3);
  });

  it('shows differences and values of entered counts', async () => {
    await service.create('t1', 'u1', { warehouseId: 'w1' });
    const result = await service.updateLines('t1', 'c1', {
      lines: [
        { productId: 'p1', countedQty: 6 },
        { productId: 'p2', lotNumber: 'L1', countedQty: 7 },
      ],
    });
    // updateLines saves rows; reflect them in the stored count for the read-back
    const byId = new Map(lineRepo.save.mock.calls[0][0].map((r: any) => [r.id, r]));
    stored.lines = stored.lines.map((l: any) => ({ ...l, ...(byId.get(l.id) ?? {}) }));
    const view = await service.findById('t1', 'c1');
    const a = view.lines.find((l) => l.productId === 'p1')!;
    expect(a.differenceQty).toBe(-2);
    expect(a.differenceValue).toBe(-20);
    expect(view.summary.gainValue).toBe(5);
    expect(view.summary.lossValue).toBe(20);
    expect(view.summary.netValue).toBe(-15);
    expect(result).toBeDefined();
  });

  it('validates into adjustments against current stock and posts the net once', async () => {
    await service.create('t1', 'u1', { warehouseId: 'w1' });
    stored.lines = stored.lines.map((l: any) => {
      if (l.productId === 'p1') return { ...l, countedQty: 6 };
      if (l.lotNumber === 'L1') return { ...l, countedQty: 7 };
      return l; // untracked rest of p2 left uncounted -> skipped
    });
    productRepo.find.mockResolvedValue([plain, tracked]);

    await service.validate('t1', 'u1', 'c1', {});

    expect(stockService.adjust).toHaveBeenCalledTimes(2);
    expect(stockService.adjust).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ productId: 'p1', quantity: -2, lots: undefined }),
      expect.objectContaining({ post: false, referenceType: 'stock_count', untrackedOnly: false }),
    );
    expect(stockService.adjust).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ productId: 'p2', quantity: 1, lots: [{ lotNumber: 'L1', quantity: 1, expiryDate: '2030-01-01' }] }),
      expect.objectContaining({ post: false }),
    );
    // losses first
    expect(stockService.adjust.mock.calls[0][2].quantity).toBe(-2);

    expect(autoPosting.post).toHaveBeenCalledTimes(1);
    const lines = autoPosting.post.mock.calls[0][0].buildLines({}, (k: string) => k);
    expect(lines).toEqual([
      { accountId: 'stockAdjustmentAccountId', debit: 15 },
      { accountId: 'inventoryAccountId', credit: 15 },
    ]);
    expect(stored.status).toBe(StockCountStatus.VALIDATED);
    expect(stored.differenceValue).toBe(-15);
  });

  it('counts uncounted lines as zero when asked, adjusting only the untracked part', async () => {
    await service.create('t1', 'u1', { warehouseId: 'w1', productIds: ['p2'] });
    productRepo.find.mockResolvedValue([tracked]);
    stored.lines = stored.lines.filter((l: any) => l.productId === 'p2');
    stored.lines = stored.lines.map((l: any) => (l.lotNumber === 'L1' ? { ...l, countedQty: 6 } : l));

    await service.validate('t1', 'u1', 'c1', { zeroUncounted: true });
    expect(stockService.adjust).toHaveBeenCalledTimes(1);
    expect(stockService.adjust).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ productId: 'p2', quantity: -4, lots: undefined }),
      expect.objectContaining({ untrackedOnly: true }),
    );
  });

  it('refuses to validate twice', async () => {
    await service.create('t1', 'u1', { warehouseId: 'w1' });
    stored.status = StockCountStatus.VALIDATED;
    await expect(service.validate('t1', 'u1', 'c1')).rejects.toThrow(ConflictException);
  });
});
