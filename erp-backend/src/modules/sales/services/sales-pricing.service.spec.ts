import { ForbiddenException } from '@nestjs/common';
import { SalesPricingService } from './sales-pricing.service';
import { PriceListRule, PriceRuleType } from '../entities/price-list-rule.entity';

const rule = (r: Partial<PriceListRule>): PriceListRule =>
  ({
    id: r.id ?? 'r',
    priceListId: 'pl',
    productId: null,
    categoryId: null,
    ruleType: PriceRuleType.FIXED,
    value: 0,
    minQuantity: 0,
    validFrom: null,
    validTo: null,
    ...r,
  }) as PriceListRule;

describe('SalesPricingService', () => {
  const product = {
    id: 'p1',
    code: 'P1',
    categoryId: 'cat-child',
    sellPrice: 100,
    costPrice: 60,
    minSellPrice: 80,
  };

  let repos: Record<string, any>;
  let rbac: { hasPermission: jest.Mock };
  let service: SalesPricingService;

  beforeEach(() => {
    repos = {
      priceList: { findOne: jest.fn() },
      rule: { find: jest.fn() },
      customer: { findOne: jest.fn() },
      customerCategory: { findOne: jest.fn() },
      product: { findOne: jest.fn().mockResolvedValue(product), find: jest.fn().mockResolvedValue([product]) },
      category: {
        findOne: jest.fn(({ where }) =>
          where.id === 'cat-child' ? { id: 'cat-child', parentId: 'cat-root' } : { id: 'cat-root', parentId: null },
        ),
      },
    };
    rbac = { hasPermission: jest.fn().mockResolvedValue(false) };
    service = new SalesPricingService(
      repos.priceList,
      repos.rule,
      repos.customer,
      repos.customerCategory,
      repos.product,
      repos.category,
      rbac as any,
    );
  });

  describe('pickRule', () => {
    const chain = ['cat-child', 'cat-root'];
    const rules = [
      rule({ id: 'global', ruleType: PriceRuleType.DISCOUNT, value: 5 }),
      rule({ id: 'root', categoryId: 'cat-root', value: 95 }),
      rule({ id: 'child', categoryId: 'cat-child', value: 92 }),
      rule({ id: 'prod', productId: 'p1', value: 90 }),
      rule({ id: 'prod-10', productId: 'p1', value: 85, minQuantity: 10 }),
      rule({ id: 'other', productId: 'p2', value: 1 }),
    ];

    it('prefers product rules and the highest quantity tier reached', () => {
      expect(SalesPricingService.pickRule(rules, 'p1', chain, 1, '2026-01-01')?.id).toBe('prod');
      expect(SalesPricingService.pickRule(rules, 'p1', chain, 10, '2026-01-01')?.id).toBe('prod-10');
    });

    it('falls back to the closest category then to global rules', () => {
      const noProduct = rules.filter((r) => !r.productId);
      expect(SalesPricingService.pickRule(noProduct, 'p1', chain, 1, '2026-01-01')?.id).toBe('child');
      expect(
        SalesPricingService.pickRule(noProduct.filter((r) => r.id !== 'child'), 'p1', chain, 1, '2026-01-01')?.id,
      ).toBe('root');
      expect(SalesPricingService.pickRule([rules[0]], 'p1', [], 1, '2026-01-01')?.id).toBe('global');
    });

    it('ignores rules outside their validity dates', () => {
      const dated = [rule({ id: 'x', productId: 'p1', validTo: '2025-12-31' })];
      expect(SalesPricingService.pickRule(dated, 'p1', chain, 1, '2026-01-01')).toBeNull();
    });
  });

  it('applies fixed, discount and markup rules', () => {
    expect(SalesPricingService.applyRule(rule({ value: 77 }), product)).toBe(77);
    expect(
      SalesPricingService.applyRule(rule({ ruleType: PriceRuleType.DISCOUNT, value: 10 }), product),
    ).toBe(90);
    expect(
      SalesPricingService.applyRule(rule({ ruleType: PriceRuleType.MARKUP, value: 50 }), product),
    ).toBe(90);
    expect(SalesPricingService.applyRule(null, product)).toBe(100);
  });

  it('resolves the price list from the customer category when the customer has none', async () => {
    repos.customer.findOne.mockResolvedValue({ id: 'c1', priceListId: null, categoryId: 'cc1' });
    repos.customerCategory.findOne.mockResolvedValue({ id: 'cc1', priceListId: 'pl', isActive: true });
    repos.priceList.findOne.mockResolvedValue({ id: 'pl', isActive: true, validFrom: null, validTo: null });
    repos.rule.find.mockResolvedValue([rule({ productId: 'p1', value: 88 })]);

    const result = await service.computePrice('t1', { productId: 'p1', customerId: 'c1', quantity: 2, date: '2026-05-01' });

    expect(result.unitPrice).toBe(88);
    expect(result.priceListId).toBe('pl');
  });

  it('uses the product sales price when the list has expired', async () => {
    repos.priceList.findOne.mockResolvedValue({ id: 'pl', isActive: true, validFrom: null, validTo: '2025-12-31' });
    const result = await service.computePrice('t1', { productId: 'p1', priceListId: 'pl', date: '2026-05-01' });
    expect(result.unitPrice).toBe(100);
    expect(result.priceListId).toBeNull();
  });

  it('fills only the lines sent without a unit price', async () => {
    repos.priceList.findOne.mockResolvedValue({ id: 'pl', isActive: true });
    repos.rule.find.mockResolvedValue([rule({ productId: 'p1', value: 88 })]);
    const { lines } = await service.priceLines(
      't1',
      { customer: { priceListId: 'pl', categoryId: null } as any, date: '2026-05-01' },
      [
        { productId: 'p1', quantity: 1 },
        { productId: 'p1', quantity: 1, unitPrice: 120 },
      ],
    );
    expect(lines.map((l) => l.unitPrice)).toEqual([88, 120]);
  });

  describe('minimum selling price', () => {
    const below = [{ productId: 'p1', quantity: 2, lineTotal: 150 }];

    it('refuses net prices below the minimum without the override permission', async () => {
      await expect(service.enforceMinPrice('t1', 'u1', below)).rejects.toThrow(ForbiddenException);
      expect(rbac.hasPermission).toHaveBeenCalledWith('t1', 'u1', {
        module: 'sales',
        screen: 'price_override',
        action: 'update',
      });
    });

    it('allows users holding sales/price_override/update', async () => {
      rbac.hasPermission.mockResolvedValue(true);
      await expect(service.enforceMinPrice('t1', 'u1', below)).resolves.toBeUndefined();
    });

    it('converts to base currency before comparing', async () => {
      // 30 per unit in a currency worth 3 base units = 90 >= 80
      await expect(
        service.enforceMinPrice('t1', 'u1', [{ productId: 'p1', quantity: 1, lineTotal: 30 }], 3),
      ).resolves.toBeUndefined();
      expect(rbac.hasPermission).not.toHaveBeenCalled();
    });
  });
});
