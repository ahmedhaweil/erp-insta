import { computeLine, computeTotals, addDays, round } from './document-totals.util';

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
});
