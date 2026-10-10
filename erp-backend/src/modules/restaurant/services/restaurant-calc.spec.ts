import { BadRequestException } from '@nestjs/common';
import {
  allocateInvoiceDiscount,
  basePriceFor,
  computeTicketTotals,
  driverCommission,
  equalSplit,
  kdsLevel,
  kitchenDelta,
  lineMergeKey,
  resolveComboPicks,
  splitSentQty,
  stationsFor,
  unitPriceWithModifiers,
} from './restaurant-calc';
import { ModifierType } from '../entities/menu.entity';
import { TicketOrderType } from '../entities/ticket.entity';
import { DriverCommissionBasis } from '../entities/master-data.entity';

describe('restaurant calculations', () => {
  describe('prices', () => {
    it('uses the delivery-app price over the list price when there is one', () => {
      expect(basePriceFor(50, 60)).toBe(60);
      expect(basePriceFor(50, null)).toBe(50);
      expect(basePriceFor(50, 0)).toBe(0);
    });

    it('adds addons, subtracts withouts and floors the unit price at zero', () => {
      const mods = [
        { type: ModifierType.ADDON, price: 10 },
        { type: ModifierType.WITHOUT, price: 3 },
      ];
      expect(unitPriceWithModifiers(50, mods)).toBe(57);
      expect(unitPriceWithModifiers(5, [{ type: ModifierType.WITHOUT, price: 8 }])).toBe(0);
    });

    it('validates combo picks against min/max and the group choices', () => {
      const groups: any[] = [
        { id: 'g1', nameAr: 'مشروب', minPicks: 1, maxPicks: 1, items: [{ productId: 'cola', extraPrice: 0, quantity: 1 }, { productId: 'juice', extraPrice: 5, quantity: 1 }] },
        { id: 'g2', nameAr: 'إضافة', minPicks: 0, maxPicks: 2, items: [{ productId: 'fries', extraPrice: 7, quantity: 2 }] },
      ];
      const comps = resolveComboPicks(groups, [
        { groupId: 'g1', productId: 'juice' },
        { groupId: 'g2', productId: 'fries' },
      ]);
      expect(comps).toEqual([
        { groupId: 'g1', productId: 'juice', unitQty: 1, extraPrice: 5 },
        { groupId: 'g2', productId: 'fries', unitQty: 2, extraPrice: 7 },
      ]);
      expect(() => resolveComboPicks(groups, [])).toThrow(BadRequestException); // g1 min 1
      expect(() =>
        resolveComboPicks(groups, [{ groupId: 'g1', productId: 'cola' }, { groupId: 'g1', productId: 'juice' }]),
      ).toThrow(BadRequestException); // g1 max 1
      expect(() => resolveComboPicks(groups, [{ groupId: 'g1', productId: 'fries' }])).toThrow(BadRequestException);
      expect(() => resolveComboPicks(groups, [{ groupId: 'gX', productId: 'cola' }])).toThrow(BadRequestException);
    });

    it('merges lines only with the same product, modifiers (any order) and note', () => {
      const a = lineMergeKey('p', [{ modifierId: 'm2' }, { modifierId: 'm1' }], ' no ice ');
      expect(a).toBe(lineMergeKey('p', [{ modifierId: 'm1' }, { modifierId: 'm2' }], 'no ice'));
      expect(a).not.toBe(lineMergeKey('p', [{ modifierId: 'm1' }], 'no ice'));
      expect(a).not.toBe(lineMergeKey('p', [{ modifierId: 'm1' }, { modifierId: 'm2' }], ''));
    });
  });

  describe('totals', () => {
    const base = {
      lines: [
        { id: 'a', quantity: 2, unitPrice: 50, discount: 10, taxRate: 14 }, // 90 after line discount
        { id: 'b', quantity: 1, unitPrice: 10, discount: 0, taxRate: 0 }, // 10
      ],
      invoiceDiscount: 10,
      serviceChargePercent: 12,
      serviceChargeTaxRate: 14,
      deliveryFee: 20,
      deliveryFeeTaxRate: 14,
    };

    it('applies tax per line after line and invoice discounts, service charge on dine-in only', () => {
      const t = computeTicketTotals({ ...base, orderType: TicketOrderType.DINE_IN });
      // invoice discount 10 spread 9 / 1 over 90 / 10
      expect(t.lines.get('a')).toEqual({ discount: 19, lineNet: 81, tax: 11.34 });
      expect(t.lines.get('b')).toEqual({ discount: 1, lineNet: 9, tax: 0 });
      expect(t.itemsGross).toBe(110);
      expect(t.discountTotal).toBe(20);
      expect(t.itemsNet).toBe(90);
      expect(t.serviceCharge).toBe(10.8);
      expect(t.serviceChargeTax).toBe(1.512);
      expect(t.deliveryFee).toBe(0);
      expect(t.subtotal).toBe(100.8);
      expect(t.taxAmount).toBe(12.852);
      expect(t.totalAmount).toBe(113.652);
    });

    it('charges no service charge on pickup/takeaway (Instasoft charged pickup)', () => {
      for (const orderType of [TicketOrderType.PICKUP, TicketOrderType.TAKEAWAY]) {
        const t = computeTicketTotals({ ...base, orderType });
        expect(t.serviceCharge).toBe(0);
        expect(t.totalAmount).toBe(101.34);
      }
    });

    it('adds the delivery fee with its own tax on delivery', () => {
      const t = computeTicketTotals({ ...base, orderType: TicketOrderType.DELIVERY });
      expect(t.serviceCharge).toBe(0);
      expect(t.deliveryFee).toBe(20);
      expect(t.deliveryFeeTax).toBe(2.8);
      expect(t.totalAmount).toBe(124.14);
    });

    it('ignores zero-quantity lines and refuses a discount larger than the ticket', () => {
      const t = computeTicketTotals({
        ...base,
        orderType: TicketOrderType.TAKEAWAY,
        invoiceDiscount: 0,
        lines: [...base.lines, { id: 'c', quantity: 0, unitPrice: 99, discount: 0, taxRate: 14 }],
      });
      expect(t.itemsGross).toBe(110);
      expect(() => computeTicketTotals({ ...base, orderType: TicketOrderType.TAKEAWAY, invoiceDiscount: 101 })).toThrow(
        BadRequestException,
      );
    });

    it('allocates the invoice discount proportionally with the rounding on the last line', () => {
      const shares = allocateInvoiceDiscount(
        [
          { id: 'x', amount: 10 },
          { id: 'y', amount: 10 },
          { id: 'z', amount: 10 },
        ],
        10,
      );
      expect(shares.get('x')).toBe(3.3333);
      expect(shares.get('y')).toBe(3.3333);
      expect(shares.get('z')).toBe(3.3334);
    });

    it('previews an equal split where shares add up to the total', () => {
      expect(equalSplit(100, 3)).toEqual([33.33, 33.33, 33.34]);
      expect(() => equalSplit(100, 1)).toThrow(BadRequestException);
    });

    it('moves the sent quantity along with a split part', () => {
      expect(splitSentQty(3, 2, 1)).toEqual({ moved: { quantity: 1, sentQty: 1 }, kept: { quantity: 2, sentQty: 1 } });
      expect(splitSentQty(3, 0, 2)).toEqual({ moved: { quantity: 2, sentQty: 0 }, kept: { quantity: 1, sentQty: 0 } });
      expect(() => splitSentQty(1, 0, 2)).toThrow(BadRequestException);
    });
  });

  describe('kitchen', () => {
    const routes = [
      { stationId: 'grill', categoryId: 'mains', productId: null },
      { stationId: 'bar', categoryId: 'drinks', productId: null },
      { stationId: 'cold', productId: 'salad-burger', categoryId: null },
    ];

    it('routes by product first, then by category', () => {
      expect(stationsFor('burger', 'mains', routes)).toEqual(['grill']);
      expect(stationsFor('salad-burger', 'mains', routes)).toEqual(['cold']);
      expect(stationsFor('x', null, routes)).toEqual([]);
    });

    it('sends only the unsent delta and cancellations for reduced lines', () => {
      const delta = kitchenDelta(
        [
          { id: 'l1', productId: 'burger', categoryId: 'mains', quantity: 3, sentQty: 1, modifiers: [] },
          { id: 'l2', productId: 'cola', categoryId: 'drinks', quantity: 2, sentQty: 2, modifiers: [] },
          { id: 'l3', productId: 'tea', categoryId: 'drinks', quantity: 0, sentQty: 1, modifiers: [] },
          { id: 'l4', productId: 'combo', categoryId: 'mains', quantity: 1, sentQty: 0, modifiers: [], isComboParent: true },
          { id: 'l5', productId: 'unrouted', categoryId: null, quantity: 1, sentQty: 0, modifiers: [] },
        ],
        routes,
      );
      expect(delta.orders.get('grill')).toEqual([expect.objectContaining({ lineId: 'l1', quantity: 2 })]);
      expect(delta.orders.has('bar')).toBe(false);
      expect(delta.cancellations.get('bar')).toEqual([expect.objectContaining({ lineId: 'l3', quantity: -1 })]);
      // the combo container is not printed but is marked sent; unrouted lines too
      expect(delta.sent).toEqual([
        { lineId: 'l1', sentQty: 3 },
        { lineId: 'l3', sentQty: 0 },
        { lineId: 'l4', sentQty: 1 },
        { lineId: 'l5', sentQty: 1 },
      ]);
    });

    it('a second send right after the first has nothing to send', () => {
      const lines = [{ id: 'l1', productId: 'burger', categoryId: 'mains', quantity: 2, sentQty: 0, modifiers: [] }];
      const first = kitchenDelta(lines, routes);
      lines[0].sentQty = first.sent[0].sentQty;
      const second = kitchenDelta(lines, routes);
      expect(second.orders.size).toBe(0);
      expect(second.sent).toEqual([]);
    });

    it('colours KDS tickets by age thresholds', () => {
      const t = { yellow: 5, orange: 10, red: 15 };
      expect(kdsLevel(2, t)).toBe('green');
      expect(kdsLevel(5, t)).toBe('yellow');
      expect(kdsLevel(12, t)).toBe('orange');
      expect(kdsLevel(15, t)).toBe('red');
    });
  });

  describe('driver commission', () => {
    const tickets = [
      { itemsNet: 100, serviceCharge: 0, deliveryFee: 15, totalAmount: 131.1 },
      { itemsNet: 200, serviceCharge: 0, deliveryFee: 25, totalAmount: 256.5 },
    ];

    it('is a percentage of the delivery fees', () => {
      const r = driverCommission({ commissionPercent: 50, commissionBasis: DriverCommissionBasis.DELIVERY_FEE }, tickets);
      expect(r).toEqual(expect.objectContaining({ tickets: 2, sales: 300, deliveryFees: 40, commission: 20 }));
    });

    it('is a percentage of net sales (not of profit, which Instasoft reported as 0)', () => {
      const r = driverCommission({ commissionPercent: 5, commissionBasis: DriverCommissionBasis.SALES }, tickets);
      expect(r.commission).toBe(15);
    });
  });
});
