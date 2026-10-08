import {
  withDefaultTaxRates,
  computeLine,
  computeTotals,
  computeWithholding,
  addDays,
  addMonths,
  round,
} from './document-totals.util';

describe('document-totals util', () => {
  it('computes untaxed line total net of discount and its tax', () => {
    const line = computeLine({ quantity: 2, unitPrice: 50, discount: 10, taxRate: 14 });
    expect(line.lineTotal).toBe(90);
    expect(line.taxAmount).toBe(12.6);
  });

  it('ignores client totals and sums lines', () => {
    const totals = computeTotals([
      computeLine({ quantity: 1, unitPrice: 100, taxRate: 15 }),
      computeLine({ quantity: 3, unitPrice: 10 }),
    ]);
    expect(totals).toEqual({ subtotal: 130, taxAmount: 15, totalAmount: 145 });
  });

  it('rejects invalid lines', () => {
    expect(() => computeLine({ quantity: 0, unitPrice: 1 })).toThrow();
    expect(() => computeLine({ quantity: 1, unitPrice: -1 })).toThrow();
    expect(() => computeLine({ quantity: 1, unitPrice: 10, discount: 11 })).toThrow();
    expect(() => computeLine({ quantity: 1, unitPrice: 10, taxRate: 101 })).toThrow();
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-01-31', 30)).toBe('2026-03-02');
    expect(addDays('2026-01-31', 0)).toBe('2026-01-31');
  });

  it('rounds half up', () => {
    expect(round(1.005)).toBe(1.01);
  });

  it('extracts VAT from tax-inclusive prices', () => {
    const line = computeLine({ quantity: 2, unitPrice: 57, taxRate: 14 }, { taxIncluded: true });
    expect(line.lineTotal).toBe(100);
    expect(line.taxAmount).toBe(14);
    expect(round(line.lineTotal + line.taxAmount, 4)).toBe(114);
  });

  it('applies tax-inclusive discounts on the gross amount', () => {
    const line = computeLine(
      { quantity: 1, unitPrice: 115, discount: 11.5, taxRate: 15 },
      { taxIncluded: true },
    );
    expect(line.lineTotal).toBe(90);
    expect(line.taxAmount).toBe(13.5);
  });

  it('keeps tax-inclusive totals equal to the gross amounts with rounding', () => {
    const lines = [
      computeLine({ quantity: 3, unitPrice: 9.99, taxRate: 14 }, { taxIncluded: true }),
      computeLine({ quantity: 1, unitPrice: 10 }, { taxIncluded: true }),
    ];
    const totals = computeTotals(lines);
    expect(totals.totalAmount).toBe(39.97);
  });

  it('computes withholding with line rates overriding the document rate', () => {
    expect(computeWithholding([{ lineTotal: 1000 }, { lineTotal: 500 }], 1)).toBe(15);
    expect(
      computeWithholding([{ lineTotal: 1000, withholdingRate: 3 }, { lineTotal: 500 }], 1),
    ).toBe(35);
    expect(computeWithholding([{ lineTotal: 1000 }], null)).toBe(0);
    expect(() => computeWithholding([{ lineTotal: 1, withholdingRate: 120 }])).toThrow();
  });

  it('adds months clamping to the month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('withDefaultTaxRates', () => {
  const defaults = new Map([['p1', 14], ['p2', 5]]);

  it('fills missing rates from the product default and keeps explicit ones, including 0', () => {
    expect(
      withDefaultTaxRates(
        [
          { productId: 'p1' },
          { productId: 'p2', taxRate: 0 },
          { productId: 'p2', taxRate: 10 },
          { productId: 'unknown', taxRate: null },
        ],
        defaults,
      ).map((l) => l.taxRate),
    ).toEqual([14, 0, 10, 0]);
  });
});
