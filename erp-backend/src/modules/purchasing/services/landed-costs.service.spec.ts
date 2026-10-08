import { BadRequestException, ConflictException } from '@nestjs/common';
import { LandedCostsService, splitLandedCost } from './landed-costs.service';
import { LandedCostSplit, LandedCostStatus } from '../entities/landed-cost.entity';

describe('splitLandedCost', () => {
  const goods = [
    { productId: 'a', quantity: 10, value: 800 },
    { productId: 'b', quantity: 30, value: 200 },
  ];

  it('splits by value, by quantity or equally, with shares adding up to the cent', () => {
    expect(splitLandedCost(goods, 100, LandedCostSplit.BY_VALUE).map((x) => x.amount)).toEqual([80, 20]);
    expect(splitLandedCost(goods, 100, LandedCostSplit.BY_QUANTITY).map((x) => x.amount)).toEqual([25, 75]);
    expect(splitLandedCost(goods, 100, LandedCostSplit.EQUAL).map((x) => x.amount)).toEqual([50, 50]);
    const thirds = splitLandedCost(
      [goods[0], goods[1], { productId: 'c', quantity: 1, value: 1 }],
      100,
      LandedCostSplit.EQUAL,
    );
    expect(thirds.map((x) => x.amount)).toEqual([33.33, 33.33, 33.34]);
  });

  it('refuses to split over nothing', () => {
    expect(() => splitLandedCost([{ productId: 'a', quantity: 0, value: 0 }], 10, LandedCostSplit.BY_VALUE)).toThrow(
      BadRequestException,
    );
  });
});

describe('LandedCostsService.post', () => {
  const qb = (rows: any[], one: any) => {
    const b: any = {};
    for (const m of ['select', 'addSelect', 'where', 'andWhere', 'groupBy', 'orderBy']) b[m] = jest.fn(() => b);
    b.getRawMany = jest.fn(async () => rows);
    b.getRawOne = jest.fn(async () => one);
    return b;
  };

  it('capitalises the share of goods still on hand and sends the rest to COGS', async () => {
    const landed: any = {
      id: 'lc1',
      number: 'LC-1',
      date: '2026-10-08',
      status: LandedCostStatus.DRAFT,
      splitMethod: LandedCostSplit.BY_VALUE,
      purchaseOrderIds: ['po1'],
      totalAmount: 100,
      charges: [{ description: 'Freight', amount: 100, accountId: 'freight' }],
    };
    const product: any = { id: 'p1', costPrice: 80 };
    const landedRepo = { findOne: jest.fn(async () => landed), save: jest.fn(async (x: any) => x) };
    const productRepo = { findOne: jest.fn(async () => product), save: jest.fn() };
    // 10 received, 6 still on hand
    const movementRepo = { createQueryBuilder: () => qb([{ product_id: 'p1', quantity: '10', value: '800' }], null) };
    const stockRepo = { createQueryBuilder: () => qb([], { qty: '6' }) };
    const autoPosting = { preflight: jest.fn(), post: jest.fn() };
    const service = new LandedCostsService(
      landedRepo as any,
      {} as any,
      productRepo as any,
      stockRepo as any,
      movementRepo as any,
      {} as any,
      autoPosting as any,
      {} as any,
    );

    const result = await service.post('t', 'u', 'lc1');

    expect(result.allocations).toEqual([
      expect.objectContaining({ productId: 'p1', amount: 100, inventoryAmount: 60, cogsAmount: 40 }),
    ]);
    expect(product.costPrice).toBe(90); // (6 x 80 + 60) / 6
    const lines = autoPosting.post.mock.calls[0][0].buildLines({}, (k: string) => k);
    expect(lines).toEqual([
      { accountId: 'inventoryAccountId', debit: 60 },
      { accountId: 'cogsAccountId', debit: 40 },
      { accountId: 'freight', credit: 100, description: 'Freight' },
    ]);
    expect(result.status).toBe(LandedCostStatus.POSTED);
    await expect(service.post('t', 'u', 'lc1')).rejects.toThrow(ConflictException);
  });
});
