import {
  BonusRuleInput,
  CampaignRuleInput,
  InvoiceDiscountRuleInput,
  PromotionContext,
  allocateDiscount,
  bonusFreeQty,
  evaluatePromotions,
  isWithinTimeWindow,
  manualDiscountPercent,
  ruleApplies,
  weekdayOf,
} from './promotion-engine';

const ctx = (o: Partial<PromotionContext> = {}): PromotionContext => ({
  channel: 'pos',
  date: '2026-10-08', // Thursday
  time: '12:00',
  branchId: 'b1',
  paymentCondition: 'cash',
  ...o,
});

const campaign = (o: Partial<CampaignRuleInput> = {}): CampaignRuleInput => ({
  id: 'c1',
  isActive: true,
  appliesTo: 'both',
  productIds: ['p1'],
  categoryIds: [],
  discountType: 'percent',
  value: 10,
  ...o,
});

const bonus = (o: Partial<BonusRuleInput> = {}): BonusRuleInput => ({
  id: 'bn1',
  isActive: true,
  appliesTo: 'both',
  productId: 'p1',
  tiers: [
    { minQty: 5, freeQty: 1 },
    { minQty: 10, freeQty: 3 },
  ],
  repeat: false,
  ...o,
});

const invoiceRule = (o: Partial<InvoiceDiscountRuleInput> = {}): InvoiceDiscountRuleInput => ({
  id: 'i1',
  isActive: true,
  appliesTo: 'both',
  discountType: 'percent',
  value: 5,
  minSubtotal: 100,
  maxSubtotal: 1000,
  paymentCondition: 'any',
  priority: 0,
  ...o,
});

const line = (o: any = {}) => ({ productId: 'p1', quantity: 2, unitPrice: 100, ...o });
const none = { campaigns: [], bonuses: [], invoiceDiscounts: [] };

describe('promotion engine', () => {
  describe('rule conditions', () => {
    it('honours dates, channel, branch, weekdays and the hour window', () => {
      expect(ruleApplies(campaign(), ctx())).toBe(true);
      expect(ruleApplies(campaign({ isActive: false }), ctx())).toBe(false);
      expect(ruleApplies(campaign({ validFrom: '2026-10-09' }), ctx())).toBe(false);
      expect(ruleApplies(campaign({ validTo: '2026-10-07' }), ctx())).toBe(false);
      expect(ruleApplies(campaign({ validFrom: '2026-10-08', validTo: '2026-10-08' }), ctx())).toBe(true);
      expect(ruleApplies(campaign({ appliesTo: 'sales' }), ctx())).toBe(false);
      expect(ruleApplies(campaign({ appliesTo: 'sales' }), ctx({ channel: 'sales' }))).toBe(true);
      // Branch is enforced (Instasoft stored it but never checked it)
      expect(ruleApplies(campaign({ branchIds: ['b2'] }), ctx())).toBe(false);
      expect(ruleApplies(campaign({ branchIds: ['b2'] }), ctx({ branchId: null }))).toBe(false);
      expect(ruleApplies(campaign({ branchIds: ['b1', 'b2'] }), ctx())).toBe(true);
      expect(ruleApplies(campaign({ weekdays: [4] }), ctx())).toBe(true);
      expect(ruleApplies(campaign({ weekdays: [5, 6] }), ctx())).toBe(false);
      expect(ruleApplies(campaign({ startTime: '10:00', endTime: '14:00' }), ctx())).toBe(true);
      expect(ruleApplies(campaign({ startTime: '13:00', endTime: '14:00' }), ctx())).toBe(false);
      // Unknown time (back-dated document): hour-window rules do not apply
      expect(ruleApplies(campaign({ startTime: '10:00', endTime: '14:00' }), ctx({ time: null }))).toBe(false);
    });

    it('supports hour windows that wrap past midnight', () => {
      expect(isWithinTimeWindow('23:30', '22:00', '02:00')).toBe(true);
      expect(isWithinTimeWindow('01:59', '22:00', '02:00')).toBe(true);
      expect(isWithinTimeWindow('02:00', '22:00', '02:00')).toBe(false);
      expect(weekdayOf('2026-10-11')).toBe(0);
    });
  });

  describe('item campaigns', () => {
    it('applies the % after the manual line discount', () => {
      const r = evaluatePromotions(ctx(), [line({ discount: 20 })], { ...none, campaigns: [campaign()] });
      // (2 x 100 - 20) x 10% = 18
      expect(r.lines[0]).toEqual(expect.objectContaining({ offerDiscount: 18, campaignId: 'c1', net: 162 }));
      expect(r.promotionDiscount).toBe(18);
    });

    it('honours a fixed amount per unit, capped at the line amount', () => {
      const r = evaluatePromotions(ctx(), [line({ quantity: 3 })], {
        ...none,
        campaigns: [campaign({ discountType: 'amount', value: 15 })],
      });
      expect(r.lines[0].offerDiscount).toBe(45);
      const capped = evaluatePromotions(ctx(), [line({ unitPrice: 10 })], {
        ...none,
        campaigns: [campaign({ discountType: 'amount', value: 15 })],
      });
      expect(capped.lines[0].offerDiscount).toBe(20);
    });

    it('matches categories including sub-categories and picks the biggest discount', () => {
      const r = evaluatePromotions(
        ctx(),
        [line({ productId: 'p9', categoryChain: ['sub', 'parent'] })],
        {
          ...none,
          campaigns: [
            campaign({ id: 'small', productIds: [], categoryIds: ['parent'], value: 5 }),
            campaign({ id: 'big', productIds: [], categoryIds: ['parent'], discountType: 'amount', value: 20 }),
            campaign({ id: 'other', productIds: [], categoryIds: ['elsewhere'], value: 50 }),
          ],
        },
      );
      expect(r.lines[0].campaignId).toBe('big');
      expect(r.lines[0].offerDiscount).toBe(40);
      expect(r.appliedRuleIds).toEqual(['big']);
    });
  });

  describe('bonus', () => {
    it('gives the highest tier reached, once unless repeat', () => {
      expect(bonusFreeQty(bonus(), 4)).toBe(0);
      expect(bonusFreeQty(bonus(), 5)).toBe(1);
      expect(bonusFreeQty(bonus(), 9)).toBe(1);
      expect(bonusFreeQty(bonus(), 25)).toBe(3);
      expect(bonusFreeQty(bonus({ repeat: true }), 25)).toBe(6); // 2 x 10 -> 2 x 3
      expect(bonusFreeQty(bonus({ repeat: true }), 9)).toBe(1);
    });

    it('adds up quantities of the product across lines and honours the unit and free product', () => {
      const r = evaluatePromotions(
        ctx(),
        [line({ quantity: 3, unitId: 'u1' }), line({ quantity: 3, unitId: 'u1' })],
        { ...none, bonuses: [bonus({ freeProductId: 'gift' })] },
      );
      expect(r.bonuses).toEqual([
        expect.objectContaining({ ruleId: 'bn1', productId: 'gift', sourceProductId: 'p1', purchasedQty: 6, freeQty: 1 }),
      ]);
      const wrongUnit = evaluatePromotions(ctx(), [line({ quantity: 6, unitId: 'u1' })], {
        ...none,
        bonuses: [bonus({ unitId: 'box' })],
      });
      expect(wrongUnit.bonuses).toEqual([]);
    });
  });

  describe('invoice discount', () => {
    it('applies on the subtotal after offers, within an inclusive band', () => {
      const rules = { ...none, campaigns: [campaign()], invoiceDiscounts: [invoiceRule({ minSubtotal: 180, maxSubtotal: 180 })] };
      const r = evaluatePromotions(ctx(), [line()], rules);
      // 200 - 20 offer = 180 subtotal, 5% = 9
      expect(r.subtotal).toBe(180);
      expect(r.invoiceDiscount).toEqual({ amount: 9, ruleId: 'i1', manual: false });
      expect(r.promotionDiscount).toBe(29);
    });

    it('respects the payment condition', () => {
      const rules = { ...none, invoiceDiscounts: [invoiceRule({ paymentCondition: 'credit' })] };
      expect(evaluatePromotions(ctx(), [line()], rules).invoiceDiscount.ruleId).toBeNull();
      expect(
        evaluatePromotions(ctx({ paymentCondition: 'credit' }), [line()], rules).invoiceDiscount.ruleId,
      ).toBe('i1');
    });

    it('takes the lowest priority number, then the oldest rule', () => {
      const rules = {
        ...none,
        invoiceDiscounts: [
          invoiceRule({ id: 'late', priority: 1, createdAt: '2026-01-01' }),
          invoiceRule({ id: 'newer', priority: 0, createdAt: '2026-05-01', discountType: 'amount', value: 7 }),
          invoiceRule({ id: 'older', priority: 0, createdAt: '2026-02-01', discountType: 'amount', value: 3 }),
        ],
      };
      expect(evaluatePromotions(ctx(), [line()], rules).invoiceDiscount).toEqual({
        amount: 3,
        ruleId: 'older',
        manual: false,
      });
    });

    it('lets a manual invoice discount win over the automatic one', () => {
      const r = evaluatePromotions(ctx({ manualInvoiceDiscount: 4 }), [line()], {
        ...none,
        invoiceDiscounts: [invoiceRule()],
      });
      expect(r.invoiceDiscount).toEqual({ amount: 4, ruleId: null, manual: true });
      expect(r.appliedRuleIds).toEqual([]);
      expect(r.promotionDiscount).toBe(0);
    });
  });

  it('allocates a document discount in proportion to line amounts, remainder on the last line', () => {
    expect(allocateDiscount([100, 200, 0], 30)).toEqual([10, 20, 0]);
    const shares = allocateDiscount([1, 1, 1], 1);
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 4);
    expect(allocateDiscount([50], 80)).toEqual([50]);
  });

  it('computes the manual discount ratio without promotion discounts', () => {
    expect(manualDiscountPercent(200, 20, 10)).toBe(15);
    expect(manualDiscountPercent(0, 5, 0)).toBe(0);
  });
});
