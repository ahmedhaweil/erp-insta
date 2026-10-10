import { ForbiddenException } from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { PosService } from '@modules/pos/services/pos.service';
import { PosPaymentMethod } from '@modules/pos/entities/pos-order.entity';
import { SalesInvoicesService } from '@modules/sales/services/sales-invoices.service';
import { SalesOrdersService } from '@modules/sales/services/sales-orders.service';

/** POS orders and sales documents with the real promotions engine (repositories mocked). */
const repo = () => ({
  find: jest.fn(async (): Promise<any[]> => []),
  findOne: jest.fn<Promise<any>, any[]>(async () => null),
  save: jest.fn(async (x: any) => (Array.isArray(x) ? x : { id: x.id ?? 'saved-id', ...x })),
  create: jest.fn((x: any) => x),
  count: jest.fn(async () => 0),
  update: jest.fn(),
  remove: jest.fn(),
});

describe('promotions integration', () => {
  let campaigns: ReturnType<typeof repo>;
  let bonuses: ReturnType<typeof repo>;
  let invoiceDiscounts: ReturnType<typeof repo>;
  let usages: ReturnType<typeof repo>;
  let settings: ReturnType<typeof repo>;
  let products: ReturnType<typeof repo>;
  let promotions: PromotionsService;

  const product = { id: 'p1', code: 'P1', sellPrice: 100, salesTaxRate: 14, categoryId: 'cat', unitId: 'u1', isActive: true };

  beforeEach(() => {
    campaigns = repo();
    bonuses = repo();
    invoiceDiscounts = repo();
    usages = repo();
    settings = repo();
    products = repo();
    products.find.mockResolvedValue([product]);
    promotions = new PromotionsService(
      campaigns as any,
      bonuses as any,
      invoiceDiscounts as any,
      usages as any,
      settings as any,
      products as any,
      repo() as any,
      { hasPermission: jest.fn(async () => false) } as any,
    );
    campaigns.find.mockResolvedValue([
      { id: 'c1', isActive: true, appliesTo: 'both', productIds: ['p1'], categoryIds: [], discountType: 'percent', value: 10 },
    ]);
    bonuses.find.mockResolvedValue([
      { id: 'bn1', nameAr: 'هدية', isActive: true, appliesTo: 'both', productId: 'p1', tiers: [{ minQty: 2, freeQty: 1 }], repeat: false },
    ]);
  });

  describe('POS createOrder', () => {
    let orders: ReturnType<typeof repo>;
    let lines: ReturnType<typeof repo>;
    let stock: Record<string, jest.Mock>;
    let autoPosting: Record<string, jest.Mock>;
    let pos: PosService;

    beforeEach(() => {
      const sessions = repo();
      const terminals = repo();
      orders = repo();
      lines = repo();
      stock = { issue: jest.fn(async (_t, _u, m: any) => ({ unitCost: 60, cost: 60 * m.quantity })) };
      autoPosting = { post: jest.fn(), preflight: jest.fn() };
      sessions.findOne.mockResolvedValue({ id: 's1', terminalId: 'term1', userId: 'cashier', status: 'open', openingCash: 0 });
      terminals.findOne.mockResolvedValue({ id: 'term1', branchId: 'b1', warehouseId: 'w1', maxDiscountPercent: null });
      orders.findOne.mockResolvedValue({ id: 'saved-id', lines: [] });
      pos = new PosService(
        sessions as any,
        orders as any,
        lines as any,
        terminals as any,
        repo() as any,
        products as any,
        { next: jest.fn(async () => 'POS-1') } as any,
        stock as any,
        autoPosting as any,
        promotions,
      );
    });

    const dto = (o: any = {}) => ({
      sessionId: 's1',
      paymentMethod: PosPaymentMethod.CASH,
      lines: [{ productId: 'p1', quantity: 2 }],
      ...o,
    });

    it('adds the campaign discount to the line, issues bonus units from stock and records usage', async () => {
      await pos.createOrder('t1', { userId: 'cashier' }, dto());

      const order = orders.save.mock.calls[0][0];
      // 200 - 10% = 180 net, tax 14% after the discount
      expect(order.subtotal).toBe(180);
      expect(order.taxAmount).toBe(25.2);
      expect(order.discount).toBe(20);

      const saved = lines.save.mock.calls[0][0];
      expect(saved).toHaveLength(2);
      expect(saved[0]).toEqual(expect.objectContaining({ quantity: 2, discount: 20 }));
      expect(saved[1]).toEqual(expect.objectContaining({ productId: 'p1', quantity: 1, unitPrice: 0, unitCost: 60 }));
      // Bonus units leave stock and their cost reaches COGS
      expect(stock.issue).toHaveBeenCalledTimes(2);
      const lastPost = autoPosting.post.mock.calls[0][0];
      const built = lastPost.buildLines({}, (k: string) => k);
      expect(built).toEqual(expect.arrayContaining([{ accountId: 'cogsAccountId', debit: 180 }]));

      expect(usages.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ documentType: 'pos_order', ruleId: 'c1', discountAmount: 20 }),
          expect.objectContaining({ documentType: 'pos_order', ruleId: 'bn1', bonusQty: 1 }),
        ]),
      );
    });

    it('skips promotions when applyPromotions is false', async () => {
      await pos.createOrder('t1', { userId: 'cashier' }, dto({ applyPromotions: false }));
      expect(orders.save.mock.calls[0][0].subtotal).toBe(200);
      expect(lines.save.mock.calls[0][0]).toHaveLength(1);
      expect(usages.save).not.toHaveBeenCalled();
    });

    it('enforces the tenant discount limit unless the cashier holds the POS override', async () => {
      settings.findOne.mockResolvedValue({ maxTotalDiscountPercent: 5 });
      await expect(
        pos.createOrder('t1', { userId: 'cashier' }, dto({ invoiceDiscount: 30 })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        pos.createOrder('t1', { userId: 'cashier', canOverrideDiscount: true }, dto({ invoiceDiscount: 30 })),
      ).resolves.toBeDefined();
    });
  });

  describe('sales documents', () => {
    const customer = { id: 'cust', isActive: true, paymentTermDays: 0, creditLimit: 0, balance: 0 };
    let invoiceRepo: ReturnType<typeof repo>;
    let invoices: SalesInvoicesService;

    beforeEach(() => {
      invoiceRepo = repo();
      const customers = repo();
      customers.findOne.mockResolvedValue(customer);
      invoiceDiscounts.find.mockResolvedValue([
        { id: 'i1', isActive: true, appliesTo: 'sales', discountType: 'amount', value: 9, minSubtotal: 0, maxSubtotal: null, paymentCondition: 'credit', priority: 0 },
      ]);
      invoices = new SalesInvoicesService(
        invoiceRepo as any,
        { create: jest.fn((x: any) => x) } as any,
        customers as any,
        { next: jest.fn(async () => 'INV-1') } as any,
        { post: jest.fn(), preflight: jest.fn(), reverseSource: jest.fn() } as any,
        undefined,
        undefined,
        promotions,
      );
    });

    const invoiceDto = (o: any = {}) => ({
      customerId: 'cust',
      date: '2026-10-08',
      lines: [{ productId: 'p1', quantity: 2, unitPrice: 100 }],
      ...o,
    });

    it('applies campaign, bonus line and the credit invoice discount when the invoice has payment terms', async () => {
      await invoices.create('t1', 'u', invoiceDto({ dueDate: '2026-11-08' }));
      const saved = invoiceRepo.save.mock.calls[0][0];
      expect(saved.lines).toHaveLength(2);
      // 200 - 20 campaign - 9 invoice discount
      expect(saved.subtotal).toBe(171);
      expect(saved.lines[1]).toEqual(expect.objectContaining({ quantity: 1, unitPrice: 0, description: 'Bonus: هدية' }));
      expect(usages.save).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ documentType: 'sales_invoice', ruleId: 'i1', discountAmount: 9 })]),
      );
    });

    it('treats an invoice due on its date as cash (credit-only rule does not apply)', async () => {
      await invoices.create('t1', 'u', invoiceDto());
      expect(invoiceRepo.save.mock.calls[0][0].subtotal).toBe(180);
    });

    it('does not re-apply promotions to an invoice created from an order', async () => {
      await invoices.create(
        't1',
        'u',
        invoiceDto({ orderId: 'so1', lines: [{ productId: 'p1', quantity: 2, unitPrice: 100, orderLineId: 'l1' }] }),
        {},
        { skipPriceChecks: true },
      );
      const saved = invoiceRepo.save.mock.calls[0][0];
      expect(saved.subtotal).toBe(200);
      expect(saved.lines).toHaveLength(1);
      expect(usages.save).not.toHaveBeenCalled();
    });

    it('voids usages when an invoice is cancelled', async () => {
      invoiceRepo.findOne.mockResolvedValue({ id: 'inv', status: 'draft', paidAmount: 0, lines: [] });
      await invoices.cancel('t1', 'u', 'inv');
      expect(usages.update).toHaveBeenCalledWith(
        { tenantId: 't1', documentType: 'sales_invoice', documentId: 'inv' },
        { isVoid: true },
      );
    });

    it('applies promotions to sales orders and records them on the order', async () => {
      const orderRepo = repo();
      const customers = repo();
      customers.findOne.mockResolvedValue({ ...customer, paymentTermDays: 30 });
      const orders = new SalesOrdersService(
        orderRepo as any,
        { create: jest.fn((x: any) => x) } as any,
        customers as any,
        { emit: jest.fn() } as any,
        { next: jest.fn(async () => 'SO-1') } as any,
        {} as any,
        invoices,
        {} as any,
        undefined,
        promotions,
      );
      await orders.create('t1', 'u', {
        customerId: 'cust',
        date: '2026-10-08',
        lines: [{ productId: 'p1', quantity: 2, unitPrice: 100 }],
      });
      const saved = orderRepo.save.mock.calls[0][0];
      expect(saved.subtotal).toBe(171);
      expect(saved.lines).toHaveLength(2);
      expect(usages.save).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ documentType: 'sales_order', ruleId: 'c1' })]),
      );
    });
  });
});
