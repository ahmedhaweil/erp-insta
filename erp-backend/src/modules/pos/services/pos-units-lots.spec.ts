import { PosService } from './pos.service';
import { PosOrderStatus, PosPaymentMethod } from '../entities/pos-order.entity';

const repo = () => ({
  find: jest.fn(async (): Promise<any[]> => []),
  findOne: jest.fn<Promise<any>, any[]>(),
  save: jest.fn(async (x: any) => (Array.isArray(x) ? x : { id: x.id ?? 'saved-id', ...x })),
  create: jest.fn((x: any) => x),
});

describe('PosService units, barcodes, sales reps and lots', () => {
  let orders: ReturnType<typeof repo>;
  let lines: ReturnType<typeof repo>;
  let stock: Record<string, jest.Mock>;
  let productsService: Record<string, jest.Mock>;
  let reps: ReturnType<typeof repo>;
  let service: PosService;
  const cashier = { userId: 'cashier' };

  beforeEach(() => {
    const sessions = repo();
    const terminals = repo();
    const products = repo();
    orders = repo();
    lines = repo();
    reps = repo();
    stock = {
      issue: jest.fn(async (_t, _u, req) => ({
        unitCost: 5,
        cost: 5 * req.quantity,
        lots: [{ lotNumber: 'SN-1', quantity: 1, expiryDate: null }, { lotNumber: 'SN-2', quantity: 1, expiryDate: null }],
      })),
      receive: jest.fn(),
      isStockable: jest.fn(async () => true),
      getUnitCost: jest.fn(async () => 5),
    };
    productsService = {
      lookupBarcode: jest.fn(async () => ({
        product: { id: 'p1' },
        unitId: 'ctn',
        factor: 12,
        price: 100,
      })),
      resolveLineUnit: jest.fn(async (_t, _p, unitId) => ({ unitId, factor: 12, sellPrice: null })),
    };
    service = new PosService(
      sessions as any,
      orders as any,
      lines as any,
      terminals as any,
      repo() as any,
      products as any,
      { next: jest.fn(async () => 'POS-000002') } as any,
      stock as any,
      { post: jest.fn(), preflight: jest.fn() } as any,
      undefined,
      productsService as any,
      reps as any,
      repo() as any,
    );
    sessions.findOne.mockResolvedValue({ id: 's1', terminalId: 'term1', userId: 'cashier', status: 'open', openingCash: 1000 });
    terminals.findOne.mockResolvedValue({ id: 'term1', warehouseId: 'w1', maxDiscountPercent: null });
    products.find.mockResolvedValue([{ id: 'p1', code: 'P1', sellPrice: 9, salesTaxRate: 0, isActive: true }]);
  });

  it('sells a scanned carton barcode: unit price from the barcode, stock issued in base units, rep from the cashier', async () => {
    reps.findOne.mockResolvedValue({ id: 'rep-1' });
    orders.findOne.mockResolvedValueOnce(null).mockResolvedValue({ id: 'saved-id', lines: [] });
    await service.createOrder('t1', cashier, {
      sessionId: 's1',
      paymentMethod: PosPaymentMethod.CARD,
      lines: [{ barcode: '6221234', quantity: 2 }],
    } as any);
    const saved = orders.save.mock.calls[0][0];
    expect(saved.totalAmount).toBe(200);
    expect(saved.salesRepId).toBe('rep-1');
    expect(stock.issue).toHaveBeenCalledWith('t1', 'cashier', expect.objectContaining({ productId: 'p1', quantity: 24 }));
    const line = lines.save.mock.calls[0][0][0];
    expect(line).toEqual(expect.objectContaining({ unitId: 'ctn', unitFactor: 12, quantity: 2, unitPrice: 100 }));
    expect(line.lots.map((l: any) => l.lotNumber)).toEqual(['SN-1', 'SN-2']);
  });

  it('defaults an alternate unit price to product price x factor', async () => {
    orders.findOne.mockResolvedValueOnce(null).mockResolvedValue({ id: 'saved-id', lines: [] });
    await service.createOrder('t1', cashier, {
      sessionId: 's1',
      paymentMethod: PosPaymentMethod.CARD,
      lines: [{ productId: 'p1', unitId: 'ctn', quantity: 1 }],
    } as any);
    expect(orders.save.mock.calls[0][0].totalAmount).toBe(108);
  });

  it('refunds restore the serials recorded on the sale (not new ones)', async () => {
    const saleLine = {
      id: 'sl1',
      productId: 'p1',
      quantity: 3,
      refundedQty: 1,
      unitPrice: 10,
      discount: 0,
      taxRate: 0,
      unitCost: 5,
      lineTotal: 30,
      unitId: null,
      unitFactor: 1,
      lots: [
        { lotNumber: 'SN-1', quantity: 1, expiryDate: null },
        { lotNumber: 'SN-2', quantity: 1, expiryDate: null },
        { lotNumber: 'SN-3', quantity: 1, expiryDate: null },
      ],
      lotsRefunded: [{ lotNumber: 'SN-1', quantity: 1, expiryDate: null }],
    };
    orders.findOne
      .mockResolvedValueOnce({
        id: 'o1',
        orderNumber: 'POS-1',
        status: PosOrderStatus.COMPLETED,
        totalAmount: 30,
        cashAmount: 0,
        lines: [saleLine],
      })
      .mockResolvedValue({ id: 'r1', lines: [] });
    await service.refundOrder('t1', cashier, 'o1', 's1', [{ productId: 'p1', quantity: 1 }]);
    expect(stock.receive).toHaveBeenCalledWith(
      't1',
      'cashier',
      expect.objectContaining({ quantity: 1, lots: [{ lotNumber: 'SN-2', quantity: 1, expiryDate: null }] }),
    );
    expect(saleLine.lotsRefunded.map((l) => l.lotNumber)).toEqual(['SN-1', 'SN-2']);

    // an explicit serial must have been sold on this line
    orders.findOne.mockResolvedValueOnce({
      id: 'o1',
      orderNumber: 'POS-1',
      status: PosOrderStatus.COMPLETED,
      totalAmount: 30,
      cashAmount: 0,
      lines: [saleLine],
    });
    await expect(
      service.refundOrder('t1', cashier, 'o1', 's1', [
        { lineId: 'sl1', quantity: 1, lots: [{ lotNumber: 'SN-1', quantity: 1 }] },
      ]),
    ).rejects.toThrow(/only 0|was not issued/);
  });
});
