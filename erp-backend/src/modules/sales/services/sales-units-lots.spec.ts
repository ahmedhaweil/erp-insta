import { ConflictException } from '@nestjs/common';
import { prepareSalesLines, baseUnitLines } from './sales-line-units';
import { SalesOrdersService } from './sales-orders.service';
import { SalesReturnsService } from './sales-returns.service';
import { SalesOrderStatus } from '../entities/sales-order.entity';
import { ReturnRefundMethod, SalesReturnStatus } from '../entities/sales-return.entity';
import { SalesInvoiceStatus, SalesInvoiceType } from '../entities/sales-invoice.entity';

describe('sales lines in alternate units', () => {
  const products = {
    resolveLineUnit: jest.fn(async (_t: string, _p: string, unitId: string) =>
      unitId === 'ctn' ? { unitId, factor: 12, sellPrice: 110 } : { unitId, factor: 6, sellPrice: null },
    ),
  };
  const pricing = {
    priceLines: jest.fn(async (_t: string, ctx: any, lines: any[]) => ({
      lines: lines.map((l) => ({ ...l, unitPrice: l.unitPrice ?? 10 })),
      priceListId: ctx.priceListId ?? null,
    })),
    defaultTaxRates: jest.fn(async () => new Map([['p1', 14]])),
  };

  it('prices a carton from the unit sell price, or the base price x factor under a price list', async () => {
    const noList = await prepareSalesLines(pricing as any, products, 't1', { customer: {} as any, date: '2026-01-01' }, [
      { productId: 'p1', unitId: 'ctn', quantity: 2 },
      { productId: 'p1', unitId: 'half', quantity: 1 },
      { productId: 'p1', quantity: 3 },
    ]);
    // price list engine priced base quantities (24, 6, 3)
    expect(pricing.priceLines.mock.calls[0][2].map((l: any) => l.quantity)).toEqual([24, 6, 3]);
    expect(noList.lines.map((l) => l.unitPrice)).toEqual([110, 60, 10]);
    expect(noList.lines.map((l: any) => l.taxRate)).toEqual([14, 14, 14]);

    const withList = await prepareSalesLines(
      pricing as any,
      products,
      't1',
      { customer: {} as any, priceListId: 'pl1', date: '2026-01-01' },
      [{ productId: 'p1', unitId: 'ctn', quantity: 1 }],
    );
    expect(withList.lines[0]).toMatchObject({ unitPrice: 120, unitFactor: 12 });
  });

  it('compares minimum prices per base unit', () => {
    expect(baseUnitLines([{ productId: 'p1', quantity: 2, unitFactor: 12, lineTotal: 240 }])[0].quantity).toBe(24);
  });
});

describe('SalesOrdersService delivery with units and lots', () => {
  it('issues the base quantity with the given lots and records them on the line', async () => {
    const order = {
      id: 'so1',
      orderNumber: 'SO-1',
      status: SalesOrderStatus.CONFIRMED,
      warehouseId: 'w1',
      lines: [
        { id: 'l1', productId: 'p1', quantity: 2, unitFactor: 12, qtyDelivered: 0, qtyReserved: 24, lots: [] },
      ],
    };
    const stock = {
      issue: jest.fn(async () => ({
        unitCost: 5,
        cost: 120,
        lots: [{ lotNumber: 'B1', quantity: 24, expiryDate: '2027-01-01' }],
      })),
      isStockable: jest.fn(async () => true),
    };
    const autoPosting = { preflight: jest.fn(), post: jest.fn() };
    const service = new SalesOrdersService(
      { findOne: jest.fn(async () => order), save: jest.fn(async (o) => o) } as any,
      { save: jest.fn(async (l) => l) } as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      stock as any,
      {} as any,
      autoPosting as any,
    );
    await service.deliver('t1', 'u1', 'so1', {
      lines: [{ lineId: 'l1', quantity: 2, lots: [{ lotNumber: 'B1', quantity: 24 }] }],
    });
    expect(stock.issue).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ quantity: 24, releaseReserved: 24, lots: [{ lotNumber: 'B1', quantity: 24 }] }),
    );
    expect(order.lines[0].lots).toEqual([{ lotNumber: 'B1', quantity: 24, expiryDate: '2027-01-01' }]);
    expect(order.lines[0].qtyDelivered).toBe(2);
    expect(autoPosting.post).toHaveBeenCalled();
  });
});

describe('SalesReturnsService lots and cancellation', () => {
  let service: SalesReturnsService;
  let orderLine: any;
  let invoicesService: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let returnRepo: Record<string, jest.Mock>;
  let current: any;

  const invoice = () => ({
    id: 'inv-1',
    invoiceNumber: 'INV-1',
    customerId: 'c1',
    moveType: SalesInvoiceType.INVOICE,
    status: SalesInvoiceStatus.POSTED,
    exchangeRate: 1,
    paidAmount: 50,
    lines: [
      { id: 'il1', productId: 'p1', quantity: 3, qtyReturned: 0, unitPrice: 100, discount: 0, taxRate: 0, orderLineId: 'ol1', unitFactor: 1 },
    ],
  });

  beforeEach(() => {
    orderLine = {
      id: 'ol1',
      orderId: 'so1',
      lots: [
        { lotNumber: 'SN-1', quantity: 1, expiryDate: null },
        { lotNumber: 'SN-2', quantity: 1, expiryDate: null },
        { lotNumber: 'SN-3', quantity: 1, expiryDate: null },
      ],
      lotsReturned: [{ lotNumber: 'SN-1', quantity: 1, expiryDate: null }],
    };
    returnRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
      findOne: jest.fn(async () => current),
    };
    invoicesService = {
      findById: jest.fn(async (_t, id) =>
        id === 'inv-1'
          ? invoice()
          : { id: 'cn-1', invoiceNumber: 'RINV-1', totalAmount: 200, paidAmount: current?.cnPaid ?? 0, status: SalesInvoiceStatus.PARTIAL },
      ),
      create: jest.fn(async () => ({ id: 'cn-1' })),
      post: jest.fn(async () => ({ id: 'cn-1' })),
      adjustCustomerBalance: jest.fn(),
      applyPayment: jest.fn(),
      setPaidAmount: jest.fn(),
      cancel: jest.fn(),
    };
    stockService = {
      isStockable: jest.fn().mockResolvedValue(true),
      receive: jest.fn(),
      issue: jest.fn(async () => ({ unitCost: 40, cost: 80, lots: [] })),
      getUnitCost: jest.fn().mockResolvedValue(40),
      availableQuantity: jest.fn(async () => ({ onHand: 5, reserved: 0, available: 5 })),
    };
    autoPosting = { preflight: jest.fn(), post: jest.fn(), reverseSource: jest.fn() };
    service = new SalesReturnsService(
      returnRepo as any,
      { create: jest.fn((x) => x), save: jest.fn((x) => x) } as any,
      { save: jest.fn((x) => x) } as any,
      { find: jest.fn(async () => [orderLine]), save: jest.fn((x) => x) } as any,
      {} as any,
      { find: jest.fn().mockResolvedValue([]) } as any,
      invoicesService as any,
      stockService as any,
      autoPosting as any,
      { next: jest.fn() } as any,
    );
  });

  const draft = (lots: any[] = []) => ({
    id: 'ret-1',
    returnNumber: 'SRET-1',
    customerId: 'c1',
    originalInvoiceId: 'inv-1',
    warehouseId: 'w1',
    date: '2026-03-01',
    status: SalesReturnStatus.DRAFT,
    refundMethod: ReturnRefundMethod.CREDIT,
    exchangeRate: 1,
    lines: [
      { id: 'rl1', invoiceLineId: 'il1', productId: 'p1', quantity: 2, unitFactor: 1, unitPrice: 100, discount: 0, taxRate: 0, lineTotal: 200, restock: true, lots },
    ],
  });

  it('restores the serials delivered on the order that were not returned yet', async () => {
    current = draft();
    await service.post('t1', 'u1', 'ret-1');
    const req = stockService.receive.mock.calls[0][2];
    expect(req.lots.map((l: any) => l.lotNumber)).toEqual(['SN-2', 'SN-3']);
    expect(orderLine.lotsReturned.map((l: any) => l.lotNumber)).toEqual(['SN-1', 'SN-2', 'SN-3']);
  });

  it('refuses a serial that was not delivered on the original order', async () => {
    current = draft([{ lotNumber: 'SN-9', quantity: 1 }, { lotNumber: 'SN-2', quantity: 1 }]);
    await expect(service.post('t1', 'u1', 'ret-1')).rejects.toThrow(/was not issued/);
  });

  const posted = (extra: any = {}) => ({
    ...draft([
      { lotNumber: 'SN-2', quantity: 1, expiryDate: null },
      { lotNumber: 'SN-3', quantity: 1, expiryDate: null },
    ]),
    status: SalesReturnStatus.POSTED,
    creditNoteId: 'cn-1',
    appliedAmount: 50,
    refundedAmount: 0,
    ...extra,
  });

  it('cancels a posted return: same serials leave stock, entries reversed, credit note un-applied and cancelled', async () => {
    orderLine.lotsReturned = [...orderLine.lots];
    current = { ...posted(), cnPaid: 50 };
    await service.cancel('t1', 'ret-1', 'u1');
    expect(stockService.issue).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ quantity: 2, referenceType: 'sales_return_cancel', lots: expect.arrayContaining([expect.objectContaining({ lotNumber: 'SN-2' })]) }),
      { includeExpiredLots: true },
    );
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'sales_return', 'ret-1', expect.any(String));
    expect(invoicesService.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1' }), -50);
    expect(invoicesService.setPaidAmount).toHaveBeenCalledWith('t1', 'cn-1', 0);
    expect(invoicesService.cancel).toHaveBeenCalledWith('t1', 'u1', 'cn-1');
    expect(orderLine.lotsReturned.map((l: any) => l.lotNumber)).toEqual(['SN-1']);
    expect(current.status).toBe(SalesReturnStatus.CANCELLED);
  });

  it('refuses to cancel when the credit note was settled otherwise', async () => {
    current = { ...posted(), cnPaid: 120 };
    await expect(service.cancel('t1', 'ret-1', 'u1')).rejects.toThrow(/already settled/);
    expect(stockService.issue).not.toHaveBeenCalled();
  });

  it('refuses to cancel when the returned goods are no longer in stock', async () => {
    current = { ...posted(), cnPaid: 50 };
    stockService.availableQuantity.mockResolvedValue({ onHand: 1, reserved: 0, available: 1 });
    await expect(service.cancel('t1', 'ret-1', 'u1')).rejects.toThrow(ConflictException);
  });
});
