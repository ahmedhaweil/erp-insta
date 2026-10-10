import { BadRequestException } from '@nestjs/common';
import {
  buildShiftPostingLines,
  computeMargin,
  computeNozzleSales,
  computeShiftCash,
  reconcileTank,
} from './fuel-calc';

const account = (k: string) => k;
const balance = (lines: { debit?: number; credit?: number }[]) =>
  Math.round(lines.reduce((s, l) => s + (l.debit ?? 0) - (l.credit ?? 0), 0) * 10000) / 10000;

describe('fuel calculations', () => {
  it('computes liters, VAT-inclusive amount and the net / VAT split', () => {
    const r = computeNozzleSales({ openingReading: 1000, closingReading: 1500, unitPrice: 11.4, taxRate: 14 });
    expect(r).toEqual({ liters: 500, amount: 5700, netAmount: 5000, taxAmount: 700 });
  });

  it('refuses a closing reading below the opening one without a meter reset', () => {
    expect(() => computeNozzleSales({ openingReading: 1000, closingReading: 900, unitPrice: 10, taxRate: 0 })).toThrow(
      BadRequestException,
    );
  });

  it('handles a meter roll-over and a replaced meter', () => {
    expect(
      computeNozzleSales({ openingReading: 999900, closingReading: 100, meterReset: true, rolloverAt: 1000000, unitPrice: 10, taxRate: 0 })
        .liters,
    ).toBe(200);
    expect(computeNozzleSales({ openingReading: 5000, closingReading: 40, meterReset: true, unitPrice: 10, taxRate: 0 }).liters).toBe(40);
  });

  it('computes the margin on the net price', () => {
    expect(computeMargin(5000, 500, 8.5)).toEqual({ cost: 4250, margin: 750 });
  });

  it('computes expected cash and the counted difference', () => {
    expect(
      computeShiftCash({ totalAmount: 5700, couponAmount: 200, cardAmount: 1000, creditAmount: 500, cashCounted: 3990 }),
    ).toEqual({ cashExpected: 4000, cashCounted: 3990, cashDifference: -10 });
    expect(computeShiftCash({ totalAmount: 100, couponAmount: 0, cardAmount: 0, creditAmount: 0 }).cashDifference).toBe(0);
  });

  it('refuses coupons + card + credit above the sales', () => {
    expect(() => computeShiftCash({ totalAmount: 100, couponAmount: 50, cardAmount: 60, creditAmount: 0 })).toThrow(
      BadRequestException,
    );
  });

  describe('shift posting lines', () => {
    // sales 5700 (net 5000 + VAT 700), of which 570 credit (invoiced separately: net 500 + VAT 70)
    const base = {
      cashExpected: 3930,
      cashCounted: 3920,
      cardAmount: 1000,
      couponAmount: 200,
      netSales: 4500,
      taxAmount: 630,
      cost: 4250,
    };

    it('posts counted cash and the shortage to cash over/short when configured', () => {
      const lines = buildShiftPostingLines({ ...base, useOverShort: true }, account as any);
      expect(lines).toEqual([
        { accountId: 'cashAccountId', debit: 3920 },
        { accountId: 'cashOverShortAccountId', debit: 10, description: 'Cash shortage' },
        { accountId: 'bankAccountId', debit: 1000 },
        { accountId: 'fuelCouponAccountId', debit: 200 },
        { accountId: 'salesAccountId', credit: 4500 },
        { accountId: 'outputTaxAccountId', credit: 630 },
        { accountId: 'cogsAccountId', debit: 4250 },
        { accountId: 'inventoryAccountId', credit: 4250 },
      ]);
      expect(balance(lines)).toBe(0);
    });

    it('credits an overage to cash over/short', () => {
      const lines = buildShiftPostingLines({ ...base, cashCounted: 3950, useOverShort: true }, account as any);
      expect(lines).toContainEqual({ accountId: 'cashOverShortAccountId', credit: 20, description: 'Cash overage' });
      expect(balance(lines)).toBe(0);
    });

    it('posts the expected cash when no over/short account is configured', () => {
      const lines = buildShiftPostingLines({ ...base, useOverShort: false }, account as any);
      expect(lines[0]).toEqual({ accountId: 'cashAccountId', debit: 3930 });
      expect(lines.some((l) => l.accountId === 'cashOverShortAccountId')).toBe(false);
      expect(balance(lines)).toBe(0);
    });
  });

  it('reconciles a tank: opening + receipts - sales vs dip', () => {
    const at = (d: string) => new Date(`${d}T10:00:00Z`);
    const r = reconcileTank(
      [
        { quantity: 10000, referenceType: 'purchase_receipt', createdAt: at('2026-09-20') },
        { quantity: -2000, referenceType: 'fuel_shift', createdAt: at('2026-09-25') },
        { quantity: 5000, referenceType: 'purchase_receipt', createdAt: at('2026-10-02') },
        { quantity: -3000, referenceType: 'fuel_shift', createdAt: at('2026-10-03') },
        { quantity: -1500, referenceType: 'fuel_shift', createdAt: at('2026-10-04') },
        { quantity: -40, referenceType: 'fuel_tank_dip', createdAt: at('2026-10-05') },
      ],
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-31T23:59:59Z'),
      8450,
    );
    expect(r).toEqual(
      expect.objectContaining({
        openingBook: 8000,
        receipts: 5000,
        sales: 4500,
        expected: 8500,
        dipAdjustments: -40,
        closingBook: 8460,
        variance: -50,
      }),
    );
  });
});
