import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PosService } from './pos.service';
import { PosOrderStatus, PosPaymentMethod } from '../entities/pos-order.entity';
import { PosCashMovementType } from '../dto/terminal.dto';

const repo = () => ({
  find: jest.fn(async (): Promise<any[]> => []),
  findOne: jest.fn<Promise<any>, any[]>(),
  save: jest.fn(async (x: any) => (Array.isArray(x) ? x : { id: x.id ?? 'saved-id', ...x })),
  create: jest.fn((x: any) => x),
});

describe('PosService', () => {
  let sessions: ReturnType<typeof repo>;
  let orders: ReturnType<typeof repo>;
  let lines: ReturnType<typeof repo>;
  let terminals: ReturnType<typeof repo>;
  let cash: ReturnType<typeof repo>;
  let products: ReturnType<typeof repo>;
  let stock: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let service: PosService;

  const session = { id: 's1', tenantId: 't1', terminalId: 'term1', userId: 'cashier', status: 'open', openingCash: 100 };
  const cashier = { userId: 'cashier' };
  const product = { id: 'p1', code: 'P1', sellPrice: 100, salesTaxRate: 14, isActive: true };

  beforeEach(() => {
    sessions = repo();
    orders = repo();
    lines = repo();
    terminals = repo();
    cash = repo();
    products = repo();
    stock = {
      issue: jest.fn(async () => ({ unitCost: 60, cost: 120 })),
      receive: jest.fn(),
      isStockable: jest.fn(async () => true),
      getUnitCost: jest.fn(async () => 70),
    };
    autoPosting = { post: jest.fn(), preflight: jest.fn() };
    service = new PosService(
      sessions as any,
      orders as any,
      lines as any,
      terminals as any,
      cash as any,
      products as any,
      { next: jest.fn(async () => 'POS-000001') } as any,
      stock as any,
      autoPosting as any,
    );
    sessions.findOne.mockResolvedValue({ ...session });
    terminals.findOne.mockResolvedValue({ id: 'term1', warehouseId: 'w1', maxDiscountPercent: 10 });
    products.find.mockResolvedValue([product]);
  });

  const order = (overrides: any = {}) => ({
    sessionId: 's1',
    paymentMethod: PosPaymentMethod.CASH,
    lines: [{ productId: 'p1', quantity: 2 }],
    ...overrides,
  });

  it('prices lines from the product master and its tax rate when the till sends none', async () => {
    orders.findOne.mockResolvedValueOnce(null).mockResolvedValue({ id: 'saved-id', lines: [] });
    await service.createOrder('t1', cashier, order());
    const saved = orders.save.mock.calls[0][0];
    expect(saved.subtotal).toBe(200);
    expect(saved.taxAmount).toBe(28);
    expect(saved.totalAmount).toBe(228);
    expect(lines.save.mock.calls[0][0][0]).toEqual(expect.objectContaining({ unitCost: 60 }));
  });

  it('returns the already recorded sale when the till resends the same client reference', async () => {
    const existing = { id: 'o1', clientReference: 'till-1-42', lines: [] };
    orders.findOne.mockResolvedValueOnce(existing);
    await expect(service.createOrder('t1', cashier, order({ clientReference: 'till-1-42' }))).resolves.toBe(existing);
    expect(stock.issue).not.toHaveBeenCalled();
    expect(orders.save).not.toHaveBeenCalled();
  });

  it('refuses a discount above the terminal limit without the override permission', async () => {
    await expect(
      service.createOrder('t1', cashier, order({ lines: [{ productId: 'p1', quantity: 1, unitPrice: 80 }] })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows the same discount to a user with the override permission', async () => {
    orders.findOne.mockResolvedValueOnce(null).mockResolvedValue({ id: 'saved-id', lines: [] });
    await expect(
      service.createOrder('t1', { userId: 'cashier', canOverrideDiscount: true }, order({ lines: [{ productId: 'p1', quantity: 1, unitPrice: 80 }] })),
    ).resolves.toBeDefined();
  });

  it("does not let a cashier sell in another cashier's session", async () => {
    await expect(service.createOrder('t1', { userId: 'other' }, order())).rejects.toThrow(ForbiddenException);
  });

  it('includes cash movements in the expected drawer amount and refuses taking out more than it holds', async () => {
    orders.find.mockResolvedValue([{ cashAmount: 50 }]);
    cash.find.mockResolvedValue([{ type: 'in', amount: 30 }, { type: 'out', amount: 20 }]);
    await expect(
      service.addCashMovement('t1', cashier, 's1', { type: PosCashMovementType.OUT, amount: 200, reason: 'safe' }),
    ).rejects.toThrow(BadRequestException);

    const closed = await service.closeSession('t1', cashier, 's1', { closingCash: 155 });
    expect(closed.expectedCash).toBe(160);
    expect(closed.cashDifference).toBe(-5);
  });

  describe('refunds', () => {
    const sale = () => ({
      id: 'o1',
      tenantId: 't1',
      status: PosOrderStatus.COMPLETED,
      totalAmount: 228,
      cashAmount: 228,
      lines: [
        { id: 'l1', productId: 'p1', quantity: 2, refundedQty: 0, unitPrice: 100, discount: 0, taxRate: 14, unitCost: 60, lineTotal: 228 },
      ],
    });

    beforeEach(() => {
      orders.find.mockResolvedValue([{ cashAmount: 228 }]);
    });

    it('refunds part of a sale at the sold cost and keeps the sale open', async () => {
      const original = sale();
      orders.findOne.mockResolvedValueOnce(original).mockResolvedValue({ id: 'r1' });
      await service.refundOrder('t1', cashier, 'o1', 's1', [{ productId: 'p1', quantity: 1 }]);

      const refund = orders.save.mock.calls[0][0];
      expect(refund.totalAmount).toBe(-114);
      expect(refund.taxAmount).toBe(-14);
      expect(refund.cashAmount).toBe(-114);
      expect(stock.receive).toHaveBeenCalledWith('t1', 'cashier', expect.objectContaining({ quantity: 1, unitCost: 60 }));
      expect(original.lines[0].refundedQty).toBe(1);
      expect(original.status).toBe(PosOrderStatus.COMPLETED);
    });

    it('marks the sale refunded once every unit is returned', async () => {
      const original = sale();
      original.lines[0].refundedQty = 1;
      orders.findOne.mockResolvedValueOnce(original).mockResolvedValue({ id: 'r1' });
      await service.refundOrder('t1', cashier, 'o1', 's1');
      expect(orders.save.mock.calls[0][0].totalAmount).toBe(-114);
      expect(original.status).toBe(PosOrderStatus.REFUNDED);
    });

    it('refuses refunding more than was sold and not yet refunded', async () => {
      const original = sale();
      original.lines[0].refundedQty = 2;
      orders.findOne.mockResolvedValueOnce(original);
      await expect(
        service.refundOrder('t1', cashier, 'o1', 's1', [{ productId: 'p1', quantity: 1 }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a full refund of an already fully refunded sale', async () => {
      const original = sale();
      original.lines[0].refundedQty = 2;
      orders.findOne.mockResolvedValueOnce(original);
      await expect(service.refundOrder('t1', cashier, 'o1', 's1')).rejects.toThrow(ConflictException);
    });
  });
});
