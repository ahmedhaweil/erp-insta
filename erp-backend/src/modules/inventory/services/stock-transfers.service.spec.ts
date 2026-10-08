import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { StockTransfersService } from './stock-transfers.service';
import { StockTransfer, StockTransferLine, StockTransferStatus } from '../entities/stock-transfer.entity';
import { Product } from '../entities/product.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { StockMovementType } from '../entities/stock-movement.entity';
import { StockService } from './stock.service';
import { ProductsService } from './products.service';
import { SequenceService } from '@shared/services/sequence.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';

describe('StockTransfersService', () => {
  let service: StockTransfersService;
  let transferRepo: Record<string, jest.Mock>;
  let lineRepo: Record<string, jest.Mock>;
  let productRepo: Record<string, jest.Mock>;
  let warehouseRepo: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let current: any;

  const whA = { id: 'wa', nameEn: 'A', branchId: 'b1' };
  const whB = { id: 'wb', nameEn: 'B', branchId: 'b1' };
  const whC = { id: 'wc', nameEn: 'C', branchId: 'b2' };

  const makeTransfer = (overrides: any = {}) => ({
    id: 'tr-1',
    tenantId: 't1',
    transferNumber: 'TRF-000001',
    fromWarehouseId: 'wa',
    toWarehouseId: 'wb',
    fromWarehouse: whA,
    toWarehouse: whB,
    status: StockTransferStatus.DRAFT,
    lines: [
      {
        id: 'l1',
        productId: 'p1',
        quantity: 10,
        qtyShipped: 0,
        qtyReceived: 0,
        unitCost: 0,
        requestedLots: null,
        shippedLots: [],
        receivedLots: [],
      },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    current = makeTransfer();
    transferRepo = {
      findOne: jest.fn(async () => current),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (e) => {
        Object.assign(current, e);
        return { id: 'tr-1', ...e };
      }),
    };
    lineRepo = { save: jest.fn(async (e) => e) };
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1', code: 'P1', type: 'goods' }) };
    warehouseRepo = { findOne: jest.fn().mockResolvedValue(whA) };
    stockService = {
      issue: jest.fn().mockResolvedValue({
        unitCost: 4,
        cost: 40,
        lots: [
          { lotNumber: 'L2', quantity: 6, expiryDate: '2031-01-01' },
          { lotNumber: 'L1', quantity: 4, expiryDate: '2030-01-01' },
        ],
      }),
      receive: jest.fn().mockResolvedValue({}),
    };
    autoPosting = { preflight: jest.fn(), post: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        StockTransfersService,
        { provide: getRepositoryToken(StockTransfer), useValue: transferRepo },
        { provide: getRepositoryToken(StockTransferLine), useValue: lineRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(Warehouse), useValue: warehouseRepo },
        { provide: StockService, useValue: stockService },
        { provide: ProductsService, useValue: { toBaseQuantity: jest.fn(async (_t, _p, q, u) => (u ? q * 12 : q)) } },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue('TRF-000001') } },
        { provide: AutoPostingService, useValue: autoPosting },
      ],
    }).compile();
    service = module.get(StockTransfersService);
  });

  it('creates a draft with quantities converted to the base unit', async () => {
    await service.create('t1', 'u1', {
      fromWarehouseId: 'wa',
      toWarehouseId: 'wb',
      lines: [{ productId: 'p1', quantity: 2, unitId: 'carton' }],
    });
    expect(transferRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: StockTransferStatus.DRAFT,
        lines: [expect.objectContaining({ productId: 'p1', quantity: 24 })],
      }),
    );
  });

  it('rejects same-warehouse transfers and services', async () => {
    await expect(
      service.create('t1', 'u1', { fromWarehouseId: 'wa', toWarehouseId: 'wa', lines: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toThrow(BadRequestException);
    productRepo.findOne.mockResolvedValue({ id: 'p1', code: 'S', type: 'service' });
    await expect(
      service.create('t1', 'u1', { fromWarehouseId: 'wa', toWarehouseId: 'wb', lines: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toThrow('cannot be transferred');
  });

  it('ships from the source as a transfer move, keeping cost and lots', async () => {
    await service.ship('t1', 'u1', 'tr-1');
    expect(stockService.issue).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ warehouseId: 'wa', quantity: 10, referenceType: 'stock_transfer' }),
      { movementType: StockMovementType.TRANSFER },
    );
    expect(current.status).toBe(StockTransferStatus.IN_TRANSIT);
    expect(current.lines[0].unitCost).toBe(4);
    expect(current.lines[0].qtyShipped).toBe(10);
  });

  it('receives partially (FEFO among shipped lots) and stays in transit', async () => {
    await service.ship('t1', 'u1', 'tr-1');
    await service.receive('t1', 'u1', 'tr-1', { lines: [{ lineId: 'l1', quantity: 5 }] });

    expect(stockService.receive).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ warehouseId: 'wb', quantity: 5, unitCost: 4 }),
      {
        movementType: StockMovementType.TRANSFER,
        lotAllocations: [
          { lotNumber: 'L1', quantity: 4, expiryDate: '2030-01-01' },
          { lotNumber: 'L2', quantity: 1, expiryDate: '2031-01-01' },
        ],
      },
    );
    expect(current.status).toBe(StockTransferStatus.IN_TRANSIT);
    expect(current.lines[0].qtyReceived).toBe(5);
    // same branch: no journal entry
    expect(autoPosting.post).not.toHaveBeenCalled();

    await service.receive('t1', 'u1', 'tr-1', {});
    expect(stockService.receive).toHaveBeenLastCalledWith(
      't1',
      'u1',
      expect.objectContaining({ quantity: 5 }),
      expect.objectContaining({ lotAllocations: [{ lotNumber: 'L2', quantity: 5, expiryDate: '2031-01-01' }] }),
    );
    expect(current.status).toBe(StockTransferStatus.DONE);
  });

  it('rejects receiving more than is in transit', async () => {
    await service.ship('t1', 'u1', 'tr-1');
    await expect(
      service.receive('t1', 'u1', 'tr-1', { lines: [{ lineId: 'l1', quantity: 11 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('posts inventory between branches when warehouses belong to different branches', async () => {
    current = makeTransfer({ toWarehouseId: 'wc', toWarehouse: whC });
    await service.validate('t1', 'u1', 'tr-1');

    expect(autoPosting.preflight).toHaveBeenCalledWith('t1', expect.any(String), ['inventoryAccountId']);
    const request = autoPosting.post.mock.calls[0][0];
    expect(request.sourceType).toBe('stock_transfer');
    const lines = request.buildLines({}, (k: string) => k);
    expect(lines).toEqual([
      { accountId: 'inventoryAccountId', debit: 40, branchId: 'b2' },
      { accountId: 'inventoryAccountId', credit: 40, branchId: 'b1' },
    ]);
    expect(current.status).toBe(StockTransferStatus.DONE);
  });

  it('cancels an unreceived shipment by returning the goods and lots to the source', async () => {
    await service.ship('t1', 'u1', 'tr-1');
    await service.cancel('t1', 'u1', 'tr-1');
    expect(stockService.receive).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ warehouseId: 'wa', quantity: 10, unitCost: 4 }),
      expect.objectContaining({
        lotAllocations: [
          { lotNumber: 'L2', quantity: 6, expiryDate: '2031-01-01' },
          { lotNumber: 'L1', quantity: 4, expiryDate: '2030-01-01' },
        ],
      }),
    );
    expect(current.status).toBe(StockTransferStatus.CANCELLED);
  });

  it('refuses to cancel a partially received transfer', async () => {
    await service.ship('t1', 'u1', 'tr-1');
    await service.receive('t1', 'u1', 'tr-1', { lines: [{ lineId: 'l1', quantity: 1 }] });
    await expect(service.cancel('t1', 'u1', 'tr-1')).rejects.toThrow(ConflictException);
  });

  it('validates explicit received lots against what was shipped', () => {
    const line: any = {
      qtyShipped: 10,
      qtyReceived: 0,
      shippedLots: [{ lotNumber: 'L1', quantity: 4, expiryDate: null }],
      receivedLots: [],
    };
    // 6 of the shipment is untracked
    expect(service.allocateReceivedLots(line, 7, [{ lotNumber: 'L1', quantity: 3 }])).toEqual([
      { lotNumber: 'L1', quantity: 3, expiryDate: null },
    ]);
    expect(() => service.allocateReceivedLots(line, 5, [{ lotNumber: 'L1', quantity: 5 }])).toThrow(
      BadRequestException,
    );
    expect(() => service.allocateReceivedLots(line, 10, [{ lotNumber: 'L1', quantity: 1 }])).toThrow(
      'do not match',
    );
  });
});
