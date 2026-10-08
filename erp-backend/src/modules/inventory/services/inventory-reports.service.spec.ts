import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { InventoryReportsService } from './inventory-reports.service';
import { Stock } from '../entities/stock.entity';
import { StockMovement } from '../entities/stock-movement.entity';
import { Product } from '../entities/product.entity';
import { StockLot } from '../entities/stock-lot.entity';

const qb = (result: { one?: any; many?: any[]; raw?: any[] }) => {
  const builder: any = {};
  for (const m of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'leftJoinAndSelect',
    'innerJoinAndSelect',
    'leftJoin',
    'groupBy',
    'addGroupBy',
    'having',
  ]) {
    builder[m] = jest.fn(() => builder);
  }
  builder.getRawOne = jest.fn().mockResolvedValue(result.one);
  builder.getMany = jest.fn().mockResolvedValue(result.many ?? []);
  builder.getRawMany = jest.fn().mockResolvedValue(result.raw ?? []);
  return builder;
};

describe('InventoryReportsService', () => {
  let service: InventoryReportsService;
  let movementRepo: Record<string, jest.Mock>;
  let productRepo: Record<string, jest.Mock>;
  let stockRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    movementRepo = { createQueryBuilder: jest.fn() };
    productRepo = { findOne: jest.fn(), find: jest.fn() };
    stockRepo = { createQueryBuilder: jest.fn(), find: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        InventoryReportsService,
        { provide: getRepositoryToken(Stock), useValue: stockRepo },
        { provide: getRepositoryToken(StockMovement), useValue: movementRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(StockLot), useValue: { createQueryBuilder: jest.fn() } },
      ],
    }).compile();
    service = module.get(InventoryReportsService);
  });

  it('item card: opening balance, running quantity/value/average cost and closing', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'p1', code: 'A', nameEn: 'Item', costPrice: 11 });
    movementRepo.createQueryBuilder
      .mockReturnValueOnce(qb({ one: { qty: '10', value: '100' } }))
      .mockReturnValueOnce(
        qb({
          many: [
            { id: 'm1', type: 'in', quantity: '10', unitCost: '12', createdAt: new Date('2026-02-01') },
            { id: 'm2', type: 'out', quantity: '-5', unitCost: '11', createdAt: new Date('2026-02-02') },
          ],
        }),
      );

    const card = await service.itemCard('t1', 'p1', { from: '2026-02-01', to: '2026-02-28' });

    expect(card.opening).toEqual({ quantity: 10, value: 100, averageCost: 10 });
    expect(card.lines[0]).toEqual(
      expect.objectContaining({ inQty: 10, value: 120, balanceQty: 20, balanceValue: 220, averageCost: 11 }),
    );
    expect(card.lines[1]).toEqual(
      expect.objectContaining({ outQty: 5, value: -55, balanceQty: 15, balanceValue: 165, averageCost: 11 }),
    );
    expect(card.closing).toEqual({ quantity: 15, value: 165, averageCost: 11 });
    expect(card.totals).toEqual({ inQty: 10, outQty: 5 });
  });

  it('item card rejects bad date ranges', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'p1' });
    await expect(service.itemCard('t1', 'p1', { from: '2026-03-01', to: '2026-02-01' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.itemCard('t1', 'p1', { from: '01/02/2026' })).rejects.toThrow(BadRequestException);
  });

  it('reorder report suggests quantities for items at or below their reorder level', async () => {
    productRepo.find.mockResolvedValue([
      { id: 'p1', code: 'A', reorderLevel: '10', reorderQty: '50', costPrice: '2' },
      { id: 'p2', code: 'B', reorderLevel: '10', reorderQty: '5', costPrice: '1' },
      { id: 'p3', code: 'C', reorderLevel: '0', reorderQty: '0', costPrice: '1' },
    ]);
    stockRepo.find.mockResolvedValue([
      { productId: 'p1', quantity: '12', reservedQty: '4' },
      { productId: 'p2', quantity: '30', reservedQty: '0' },
    ]);
    const report = await service.reorder('t1');
    expect(report.lines).toHaveLength(1);
    expect(report.lines[0]).toEqual(
      expect.objectContaining({ productId: 'p1', available: 8, suggestedQty: 50, estimatedCost: 100 }),
    );
  });

  it('slow-moving lists stocked items without issues in the period', async () => {
    const old = new Date(Date.now() - 400 * 86400000);
    movementRepo.createQueryBuilder.mockReturnValue(
      qb({
        raw: [
          { productId: 'p1', warehouseId: 'w1', lastMovementAt: old, lastIssueAt: old, issuedQty: '0' },
          { productId: 'p2', warehouseId: 'w1', lastMovementAt: new Date(), lastIssueAt: new Date(), issuedQty: '3' },
        ],
      }),
    );
    stockRepo.createQueryBuilder.mockReturnValue(
      qb({
        many: [
          { productId: 'p1', warehouseId: 'w1', quantity: '5', product: { code: 'A', costPrice: '2' }, warehouse: {} },
          { productId: 'p2', warehouseId: 'w1', quantity: '5', product: { code: 'B', costPrice: '2' }, warehouse: {} },
        ],
      }),
    );
    const report = await service.slowMoving('t1', { days: 90 });
    expect(report.lines.map((l) => l.productId)).toEqual(['p1']);
    expect(report.lines[0].noMovement).toBe(true);
    expect(report.totalValue).toBe(10);
  });
});
