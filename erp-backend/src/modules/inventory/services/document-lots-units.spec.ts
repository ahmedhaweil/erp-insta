import { BadRequestException } from '@nestjs/common';
import { addLots, pickReturnLots, subtractLots, totalLots } from './document-lots.util';
import { fromBaseQty, resolveLineUnits, toBaseQty } from './document-units.util';
import { InventorySettingsService } from './inventory-settings.service';

describe('document units', () => {
  it('converts line quantities to and from base units', () => {
    expect(toBaseQty(2, 12)).toBe(24);
    expect(toBaseQty(1.5, 6)).toBe(9);
    expect(toBaseQty(3, null)).toBe(3);
    expect(fromBaseQty(6, 12)).toBe(0.5);
  });

  it('resolves alternate units, keeps carried factors and defaults to the base unit', async () => {
    const products = {
      resolveLineUnit: jest.fn(async (_t: string, _p: string, unitId: string) => ({
        unitId,
        factor: 12,
        sellPrice: 100,
      })),
    };
    const lines = await resolveLineUnits(products as any, 't1', [
      { productId: 'p1', quantity: 2 } as any,
      { productId: 'p1', unitId: 'ctn', quantity: 2 } as any,
      { productId: 'p1', unitId: 'ctn', unitFactor: 10, quantity: 1 } as any,
    ]);
    expect(lines[0]).toMatchObject({ unitId: null, unitFactor: 1, unitSellPrice: null });
    expect(lines[1]).toMatchObject({ unitId: 'ctn', unitFactor: 12, unitSellPrice: 100 });
    // a factor stored on the source document is reused (order -> invoice)
    expect(lines[2]).toMatchObject({ unitId: 'ctn', unitFactor: 10 });
    expect(products.resolveLineUnit).toHaveBeenCalledTimes(1);
  });

  it('refuses alternate units without the products service', async () => {
    await expect(
      resolveLineUnits(undefined, 't1', [{ productId: 'p1', unitId: 'ctn' }]),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('document lots', () => {
  const sold = [
    { lotNumber: 'SN-1', quantity: 1, expiryDate: null },
    { lotNumber: 'SN-2', quantity: 1, expiryDate: null },
    { lotNumber: 'SN-3', quantity: 1, expiryDate: null },
  ];

  it('adds and subtracts lot quantities by lot number', () => {
    const merged = addLots([{ lotNumber: 'L1', quantity: 2, expiryDate: '2027-01-01' }], [{ lotNumber: 'L1', quantity: 3 }]);
    expect(merged).toEqual([{ lotNumber: 'L1', quantity: 5, expiryDate: '2027-01-01' }]);
    expect(subtractLots(sold, [{ lotNumber: 'SN-2', quantity: 1 }]).map((l) => l.lotNumber)).toEqual(['SN-1', 'SN-3']);
    expect(totalLots(sold)).toBe(3);
  });

  it('restores the original serials by default, skipping those already returned', () => {
    const available = subtractLots(sold, [{ lotNumber: 'SN-1', quantity: 1 }]);
    expect(pickReturnLots(available, 2)).toEqual([
      { lotNumber: 'SN-2', quantity: 1, expiryDate: null },
      { lotNumber: 'SN-3', quantity: 1, expiryDate: null },
    ]);
  });

  it('accepts explicit lots only among those issued and keeps their expiry', () => {
    const lots = [{ lotNumber: 'B7', quantity: 5, expiryDate: '2027-03-01' }];
    expect(pickReturnLots(lots, 2, [{ lotNumber: 'B7', quantity: 2 }])).toEqual([
      { lotNumber: 'B7', quantity: 2, expiryDate: '2027-03-01' },
    ]);
    expect(() => pickReturnLots(sold, 1, [{ lotNumber: 'SN-9', quantity: 1 }])).toThrow(/was not issued/);
    expect(() => pickReturnLots(lots, 6, [{ lotNumber: 'B7', quantity: 6 }])).toThrow(/only 5/);
    expect(() => pickReturnLots(lots, 3, [{ lotNumber: 'B7', quantity: 2 }])).toThrow(/must equal/);
  });

  it('falls back to the automatic lot when nothing (or not enough) was recorded', () => {
    expect(pickReturnLots([], 2)).toBeUndefined();
    expect(pickReturnLots([{ lotNumber: 'L', quantity: 1, expiryDate: null }], 2)).toBeUndefined();
  });
});

describe('per-warehouse negative stock policy', () => {
  const tenantRepo = { findOne: jest.fn(async () => ({ settings: { inventory: { allowNegativeStock: false } } })) };

  it('lets a warehouse flag override the tenant setting', async () => {
    const warehouseRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.id === 'w-allow' ? { allowNegativeStock: true } : where.id === 'w-block' ? { allowNegativeStock: false } : { allowNegativeStock: null },
      ),
    };
    const svc = new InventorySettingsService(tenantRepo as any, warehouseRepo as any);
    expect(await svc.allowNegativeStock('t1', 'w-allow')).toBe(true);
    expect(await svc.allowNegativeStock('t1', 'w-block')).toBe(false);
    expect(await svc.allowNegativeStock('t1', 'w-default')).toBe(false);
    expect(await svc.allowNegativeStock('t1')).toBe(false);
  });
});
