import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';

const repo = () => ({
  find: jest.fn(async (): Promise<any[]> => []),
  findOne: jest.fn<Promise<any>, any[]>(async () => null),
  save: jest.fn(async (x: any) => (Array.isArray(x) ? x : { id: x.id ?? 'saved-id', ...x })),
  create: jest.fn((x: any) => x),
  count: jest.fn(async () => 0),
  update: jest.fn(),
  remove: jest.fn(),
});

describe('PromotionsService', () => {
  let campaigns: ReturnType<typeof repo>;
  let bonuses: ReturnType<typeof repo>;
  let invoiceDiscounts: ReturnType<typeof repo>;
  let usages: ReturnType<typeof repo>;
  let settings: ReturnType<typeof repo>;
  let products: ReturnType<typeof repo>;
  let categories: ReturnType<typeof repo>;
  let rbac: { hasPermission: jest.Mock };
  let service: PromotionsService;

  const p1 = { id: 'p1', code: 'P1', sellPrice: 100, salesTaxRate: 14, categoryId: 'sub', unitId: 'u1', isActive: true };
  const gift = { id: 'gift', code: 'G', sellPrice: 30, salesTaxRate: 14, categoryId: 'sub', unitId: 'u1', isActive: true };
  const ctx = { channel: 'pos' as const, date: '2026-10-08', time: '12:00', branchId: 'b1', paymentCondition: 'cash' as const };
  const lines = () => [{ productId: 'p1', quantity: 6, unitPrice: 100, discount: 0, taxRate: 14 }];

  beforeEach(() => {
    campaigns = repo();
    bonuses = repo();
    invoiceDiscounts = repo();
    usages = repo();
    settings = repo();
    products = repo();
    categories = repo();
    rbac = { hasPermission: jest.fn(async () => false) };
    service = new PromotionsService(
      campaigns as any,
      bonuses as any,
      invoiceDiscounts as any,
      usages as any,
      settings as any,
      products as any,
      categories as any,
      rbac as any,
    );
    products.find.mockResolvedValue([p1, gift]);
    categories.find.mockResolvedValue([
      { id: 'sub', parentId: 'parent' },
      { id: 'parent', parentId: null },
    ]);
  });

  describe('applyToDocument', () => {
    it('adds offer and invoice discounts to line discounts and appends bonus lines', async () => {
      campaigns.find.mockResolvedValue([
        { id: 'c1', nameAr: 'عرض', isActive: true, appliesTo: 'both', productIds: [], categoryIds: ['parent'], discountType: 'percent', value: '10', branchIds: [], weekdays: [] },
      ]);
      bonuses.find.mockResolvedValue([
        { id: 'bn1', nameAr: 'هدية', nameEn: 'Gift', isActive: true, appliesTo: 'pos', productId: 'p1', freeProductId: null, tiers: [{ minQty: 5, freeQty: 1 }], repeat: false, branchIds: ['b1'] },
      ]);
      invoiceDiscounts.find.mockResolvedValue([
        { id: 'i1', isActive: true, appliesTo: 'both', discountType: 'amount', value: '40', minSubtotal: '500', maxSubtotal: null, paymentCondition: 'cash', priority: 0 },
      ]);

      const result = await service.applyToDocument('t1', ctx, lines(), { userId: 'u' });

      // 600 gross, 60 campaign, 40 invoice discount on 540
      expect(result.lines[0]).toEqual(
        expect.objectContaining({ discount: 100, manualDiscount: 0, promotionDiscount: 100, isBonus: false }),
      );
      expect(result.lines[1]).toEqual(
        expect.objectContaining({ productId: 'p1', quantity: 1, unitPrice: 0, taxRate: 14, isBonus: true, description: 'Bonus: Gift' }),
      );
      expect(result.usages).toEqual(
        expect.arrayContaining([
          { ruleType: 'campaign', ruleId: 'c1', discountAmount: 60, bonusQty: 0 },
          { ruleType: 'bonus', ruleId: 'bn1', discountAmount: 100, bonusQty: 1 },
          { ruleType: 'invoice_discount', ruleId: 'i1', discountAmount: 40, bonusQty: 0 },
        ]),
      );
    });

    it('applies nothing automatic when applyPromotions is false but still spreads a manual invoice discount', async () => {
      campaigns.find.mockResolvedValue([
        { id: 'c1', isActive: true, appliesTo: 'both', productIds: ['p1'], categoryIds: [], discountType: 'percent', value: 50 },
      ]);
      const result = await service.applyToDocument(
        't1',
        ctx,
        [...lines(), { productId: 'gift', quantity: 2, unitPrice: 300, taxRate: 14 }],
        { userId: 'u', applyPromotions: false, manualInvoiceDiscount: 120 },
      );
      expect(campaigns.find).not.toHaveBeenCalled();
      expect(result.lines.map((l) => l.discount)).toEqual([60, 60]);
      expect(result.lines.map((l) => l.manualDiscount)).toEqual([60, 60]);
      expect(result.usages).toEqual([]);
    });

    it('refuses a manual invoice discount larger than the subtotal', async () => {
      await expect(
        service.applyToDocument('t1', ctx, lines(), { userId: 'u', manualInvoiceDiscount: 700 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe('max total discount', () => {
      beforeEach(() => settings.findOne.mockResolvedValue({ tenantId: 't1', maxTotalDiscountPercent: '10' }));

      it('refuses manual discounts above the tenant limit without the override permission', async () => {
        const input = [{ ...lines()[0], discount: 40 }];
        await expect(
          service.applyToDocument('t1', ctx, input, { userId: 'u', manualInvoiceDiscount: 30 }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(rbac.hasPermission).toHaveBeenCalledWith('t1', 'u', {
          module: 'promotions',
          screen: 'discounts',
          action: 'override',
        });
      });

      it('allows it with promotions/discounts/override or the POS override', async () => {
        const input = [{ ...lines()[0], discount: 40 }];
        await expect(
          service.applyToDocument('t1', ctx, input, { userId: 'u', manualInvoiceDiscount: 30, canOverrideDiscount: true }),
        ).resolves.toBeDefined();
        rbac.hasPermission.mockResolvedValue(true);
        await expect(
          service.applyToDocument('t1', ctx, input, { userId: 'u', manualInvoiceDiscount: 30 }),
        ).resolves.toBeDefined();
      });

      it('does not count promotion discounts against the limit', async () => {
        campaigns.find.mockResolvedValue([
          { id: 'c1', isActive: true, appliesTo: 'both', productIds: ['p1'], categoryIds: [], discountType: 'percent', value: 50 },
        ]);
        const input = [{ ...lines()[0], discount: 30 }]; // 5% manual
        const result = await service.applyToDocument('t1', ctx, input, { userId: 'u' });
        expect(result.lines[0].discount).toBe(315); // 30 + 50% of 570
        expect(rbac.hasPermission).not.toHaveBeenCalled();
      });
    });
  });

  it('records and voids usages for a document', async () => {
    await service.recordUsages('t1', 'pos_order', 'o1', '2026-10-08', [
      { ruleType: 'campaign', ruleId: 'c1', discountAmount: 5, bonusQty: 0 },
    ]);
    expect(usages.save).toHaveBeenCalledWith([
      expect.objectContaining({ tenantId: 't1', documentType: 'pos_order', documentId: 'o1', ruleId: 'c1', discountAmount: 5, isVoid: false }),
    ]);
    await service.recordUsages('t1', 'pos_order', 'o2', '2026-10-08', []);
    expect(usages.save).toHaveBeenCalledTimes(1);
    await service.voidUsages('t1', 'sales_invoice', 'inv1');
    expect(usages.update).toHaveBeenCalledWith(
      { tenantId: 't1', documentType: 'sales_invoice', documentId: 'inv1' },
      { isVoid: true },
    );
  });

  it('reports promotion cost per rule', async () => {
    usages.find.mockResolvedValue([
      { ruleType: 'campaign', ruleId: 'c1', documentType: 'pos_order', documentId: 'o1', discountAmount: '10', bonusQty: '0' },
      { ruleType: 'campaign', ruleId: 'c1', documentType: 'pos_order', documentId: 'o2', discountAmount: '15', bonusQty: '0' },
      { ruleType: 'bonus', ruleId: 'bn1', documentType: 'sales_invoice', documentId: 'i1', discountAmount: '30', bonusQty: '1' },
    ]);
    campaigns.find.mockResolvedValue([{ id: 'c1', nameAr: 'عرض', nameEn: 'Offer' }]);
    const report = await service.costReport('t1', '2026-10-01', '2026-10-31');
    expect(report.rows).toEqual([
      expect.objectContaining({ ruleType: 'bonus', ruleId: 'bn1', documents: 1, discountAmount: 30, bonusQty: 1 }),
      expect.objectContaining({ ruleType: 'campaign', ruleId: 'c1', nameEn: 'Offer', documents: 2, discountAmount: 25 }),
    ]);
    expect(report.totalDiscount).toBe(55);
  });

  describe('rule maintenance', () => {
    it('validates campaigns', async () => {
      await expect(
        service.createCampaign('t1', 'u', { nameAr: 'x', discountType: 'percent', value: 10 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createCampaign('t1', 'u', { nameAr: 'x', productIds: ['p1'], discountType: 'percent', value: 120 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createCampaign('t1', 'u', {
          nameAr: 'x', productIds: ['p1'], discountType: 'amount', value: 5, validFrom: '2026-10-10', validTo: '2026-10-01',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const saved = await service.createCampaign('t1', 'u', {
        nameAr: 'x', productIds: ['p1'], discountType: 'amount', value: 5, startTime: '10:00', endTime: '12:00',
      });
      expect(saved).toEqual(expect.objectContaining({ isActive: true, appliesTo: 'both', branchIds: [], value: 5 }));
    });

    it('validates bonus tiers and invoice discount bands', async () => {
      await expect(
        service.createBonusRule('t1', 'u', { nameAr: 'x', productId: 'p1', tiers: [{ minQty: 5, freeQty: 1 }, { minQty: 5, freeQty: 2 }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      products.find.mockResolvedValue([p1]);
      await expect(
        service.createBonusRule('t1', 'u', { nameAr: 'x', productId: 'p1', freeProductId: 'missing', tiers: [{ minQty: 5, freeQty: 1 }] }),
      ).rejects.toThrow('Product not found');
      await expect(
        service.createInvoiceDiscount('t1', 'u', { nameAr: 'x', discountType: 'percent', value: 5, minSubtotal: 500, maxSubtotal: 100 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('activates / deactivates and refuses to delete used rules', async () => {
      campaigns.findOne.mockResolvedValue({ id: 'c1', tenantId: 't1', isActive: true });
      await expect(service.setActive('t1', 'campaign', 'c1', false)).resolves.toEqual(
        expect.objectContaining({ isActive: false }),
      );
      usages.count.mockResolvedValue(2);
      await expect(service.remove('t1', 'campaign', 'c1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('price check returns list price, campaign price and cheaper alternatives', async () => {
    products.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(p1);
    campaigns.find.mockResolvedValue([
      { id: 'c1', nameAr: 'عرض', isActive: true, appliesTo: 'both', productIds: ['p1'], categoryIds: [], discountType: 'percent', value: 20 },
    ]);
    products.find.mockResolvedValue([{ id: 'p2', code: 'P2', nameAr: 'ب', sellPrice: '80' }]);
    const result = await service.priceCheck('t1', { code: 'P1' });
    expect(result.listPrice).toBe(100);
    expect(result.campaignPrice).toBe(80);
    expect(result.alternatives).toEqual([expect.objectContaining({ id: 'p2', sellPrice: 80 })]);
  });
});
