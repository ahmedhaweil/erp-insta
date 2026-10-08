import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { LotsService, fefoSort } from './lots.service';
import { StockLot } from '../entities/stock-lot.entity';
import { StockLotMovement } from '../entities/stock-lot-movement.entity';
import { TrackingType } from '../entities/product.entity';
import { addDays, today } from '@shared/utils/document-totals.util';

describe('LotsService', () => {
  let service: LotsService;
  let lotRepo: Record<string, jest.Mock>;
  let lotMoveRepo: Record<string, jest.Mock>;

  const lotProduct = { id: 'p1', code: 'MED', trackingType: TrackingType.LOT, hasExpiry: true } as any;
  const serialProduct = { id: 'p2', code: 'PHONE', trackingType: TrackingType.SERIAL, hasExpiry: false } as any;
  const plain = { id: 'p3', code: 'PLAIN', trackingType: TrackingType.NONE } as any;
  const ctx = { tenantId: 't1', userId: 'u1', productId: 'p1', warehouseId: 'w1', referenceType: 'test' };

  beforeEach(async () => {
    lotRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => ({ id: `lot-${dto.lotNumber}`, ...dto })),
      save: jest.fn((e) => e),
    };
    lotMoveRepo = { create: jest.fn((dto) => dto), save: jest.fn((e) => e), find: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        LotsService,
        { provide: getRepositoryToken(StockLot), useValue: lotRepo },
        { provide: getRepositoryToken(StockLotMovement), useValue: lotMoveRepo },
      ],
    }).compile();
    service = module.get(LotsService);
  });

  describe('prepareIncoming', () => {
    it('rejects lots on untracked products and returns nothing otherwise', () => {
      expect(() =>
        service.prepareIncoming(plain, 1, [{ lotNumber: 'X', quantity: 1 }], { strict: false, fallbackName: 'R' }),
      ).toThrow(BadRequestException);
      expect(service.prepareIncoming(plain, 1, undefined, { strict: true, fallbackName: 'R' })).toEqual([]);
    });

    it('requires lots in strict mode and auto-creates a lot otherwise', () => {
      expect(() => service.prepareIncoming(lotProduct, 5, undefined, { strict: true, fallbackName: 'PO-1' })).toThrow(
        BadRequestException,
      );
      expect(service.prepareIncoming(lotProduct, 5, undefined, { strict: false, fallbackName: 'PO-1' })).toEqual([
        { lotNumber: 'PO-1', quantity: 5, expiryDate: null },
      ]);
    });

    it('generates one serial per unit on the generic path', () => {
      const result = service.prepareIncoming(serialProduct, 3, undefined, { strict: false, fallbackName: 'PO-9' });
      expect(result.map((r) => r.lotNumber)).toEqual(['PO-9-001', 'PO-9-002', 'PO-9-003']);
      expect(result.every((r) => r.quantity === 1)).toBe(true);
    });

    it('enforces serial quantity 1 and uniqueness within the move', () => {
      expect(() =>
        service.prepareIncoming(serialProduct, 2, [{ lotNumber: 'S1', quantity: 2 }], { strict: true, fallbackName: '' }),
      ).toThrow('quantity 1');
      expect(() =>
        service.prepareIncoming(
          serialProduct,
          2,
          [
            { lotNumber: 'S1', quantity: 1 },
            { lotNumber: 'S1', quantity: 1 },
          ],
          { strict: true, fallbackName: '' },
        ),
      ).toThrow('duplicated');
    });

    it('requires lot totals to match and expiry dates in strict mode', () => {
      expect(() =>
        service.prepareIncoming(lotProduct, 5, [{ lotNumber: 'A', quantity: 4, expiryDate: '2030-01-01' }], {
          strict: true,
          fallbackName: '',
        }),
      ).toThrow('must equal');
      expect(() =>
        service.prepareIncoming(lotProduct, 5, [{ lotNumber: 'A', quantity: 5 }], { strict: true, fallbackName: '' }),
      ).toThrow('Expiry date is required');
    });

    it('merges repeated lot numbers', () => {
      const result = service.prepareIncoming(
        lotProduct,
        5,
        [
          { lotNumber: 'A', quantity: 2, expiryDate: '2030-01-01' },
          { lotNumber: 'A ', quantity: 3 },
        ],
        { strict: true, fallbackName: '' },
      );
      expect(result).toEqual([{ lotNumber: 'A', quantity: 5, expiryDate: '2030-01-01' }]);
    });
  });

  describe('addLots', () => {
    it('rejects a serial number already in stock', async () => {
      lotRepo.findOne.mockResolvedValueOnce({ id: 'x', lotNumber: 'S1', quantity: 1 });
      await expect(
        service.addLots({ ...ctx, productId: 'p2' }, serialProduct, [{ lotNumber: 'S1', quantity: 1, expiryDate: null }]),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a different expiry for an existing lot', async () => {
      lotRepo.findOne.mockResolvedValueOnce({ id: 'l', lotNumber: 'A', quantity: 2, expiryDate: '2030-01-01' });
      await expect(
        service.addLots(ctx, lotProduct, [{ lotNumber: 'A', quantity: 1, expiryDate: '2031-01-01' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the lot and journals the movement', async () => {
      const [lot] = await service.addLots(ctx, lotProduct, [{ lotNumber: 'A', quantity: 4, expiryDate: '2030-01-01' }], 7);
      expect(lot.quantity).toBe(4);
      expect(lot.unitCost).toBe(7);
      expect(lotMoveRepo.save).toHaveBeenCalledWith(expect.objectContaining({ lotNumber: 'A', quantity: 4 }));
    });
  });

  describe('consume', () => {
    const expired = { id: 'e', lotNumber: 'OLD', quantity: 5, expiryDate: addDays(today(), -1) };
    const soon = { id: 's', lotNumber: 'SOON', quantity: 3, expiryDate: addDays(today(), 10) };
    const later = { id: 'l', lotNumber: 'LATER', quantity: 10, expiryDate: addDays(today(), 100) };

    it('picks first-expiry-first-out and skips expired lots', async () => {
      lotRepo.find.mockResolvedValue([{ ...later }, { ...expired }, { ...soon }]);
      const taken = await service.consume(ctx, lotProduct, 5, { onHand: 18 });
      expect(taken.map((t) => [t.lotNumber, t.quantity])).toEqual([
        ['SOON', 3],
        ['LATER', 2],
      ]);
    });

    it('includes expired lots when asked (write-offs, transfers)', async () => {
      lotRepo.find.mockResolvedValue([{ ...later }, { ...expired }, { ...soon }]);
      const taken = await service.consume(ctx, lotProduct, 6, { onHand: 18, includeExpired: true });
      expect(taken.map((t) => [t.lotNumber, t.quantity])).toEqual([
        ['OLD', 5],
        ['SOON', 1],
      ]);
    });

    it('uses untracked stock after the lots and fails when only expired stock is left', async () => {
      lotRepo.find.mockResolvedValue([{ ...soon }, { ...expired }]);
      // on hand 10 = 3 (soon) + 5 (expired) + 2 untracked
      const taken = await service.consume(ctx, lotProduct, 5, { onHand: 10 });
      expect(taken).toEqual([{ lotNumber: 'SOON', quantity: 3, expiryDate: soon.expiryDate }]);

      lotRepo.find.mockResolvedValue([{ ...soon }, { ...expired }]);
      await expect(service.consume(ctx, lotProduct, 6, { onHand: 10 })).rejects.toThrow('expired lots');
    });

    it('takes explicit lots and rejects insufficient ones', async () => {
      lotRepo.findOne.mockResolvedValueOnce({ ...later });
      const taken = await service.consume(ctx, lotProduct, 4, { onHand: 10, lots: [{ lotNumber: 'LATER', quantity: 4 }] });
      expect(taken[0]).toEqual(expect.objectContaining({ lotNumber: 'LATER', quantity: 4 }));
      expect(lotRepo.save).toHaveBeenCalledWith(expect.objectContaining({ quantity: 6 }));

      lotRepo.findOne.mockResolvedValueOnce({ ...soon });
      await expect(
        service.consume(ctx, lotProduct, 4, { onHand: 10, lots: [{ lotNumber: 'SOON', quantity: 4 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('is a no-op for untracked products', async () => {
      expect(await service.consume(ctx, plain, 5, { onHand: 5 })).toEqual([]);
      expect(lotRepo.find).not.toHaveBeenCalled();
    });
  });

  it('fefoSort puts lots without expiry last', () => {
    const sorted = fefoSort([
      { expiryDate: null, receivedDate: '2024-01-01' },
      { expiryDate: '2030-01-01', receivedDate: '2024-01-02' },
      { expiryDate: '2029-01-01', receivedDate: '2024-01-03' },
    ]);
    expect(sorted.map((s) => s.expiryDate)).toEqual(['2029-01-01', '2030-01-01', null]);
  });
});
