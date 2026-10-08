import { BadRequestException, ConflictException } from '@nestjs/common';
import { SalesReturnsService } from './sales-returns.service';
import { ReturnRefundMethod, SalesReturnStatus } from '../entities/sales-return.entity';
import { SalesInvoiceStatus, SalesInvoiceType } from '../entities/sales-invoice.entity';

describe('SalesReturnsService', () => {
  let service: SalesReturnsService;
  let returnRepo: Record<string, jest.Mock>;
  let invoiceLineRepo: Record<string, jest.Mock>;
  let orderLineRepo: Record<string, jest.Mock>;
  let movementRepo: Record<string, jest.Mock>;
  let invoicesService: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;

  const invoice = () => ({
    id: 'inv-1',
    invoiceNumber: 'INV-1',
    customerId: 'c1',
    moveType: SalesInvoiceType.INVOICE,
    status: SalesInvoiceStatus.POSTED,
    pricesIncludeTax: false,
    exchangeRate: 1,
    withholdingRate: 0,
    lines: [
      {
        id: 'il1',
        productId: 'p1',
        quantity: 5,
        qtyReturned: 2,
        unitPrice: 100,
        discount: 50,
        taxRate: 14,
        orderLineId: 'ol1',
        withholdingRate: null,
      },
    ],
  });

  const draftReturn = (overrides: Record<string, unknown> = {}) => ({
    id: 'ret-1',
    returnNumber: 'SRET-1',
    customerId: 'c1',
    originalInvoiceId: 'inv-1',
    warehouseId: 'wh1',
    date: '2026-03-01',
    status: SalesReturnStatus.DRAFT,
    refundMethod: ReturnRefundMethod.CREDIT,
    pricesIncludeTax: false,
    exchangeRate: 1,
    lines: [
      {
        id: 'rl1',
        invoiceLineId: 'il1',
        productId: 'p1',
        quantity: 2,
        unitPrice: 100,
        discount: 20,
        taxRate: 14,
        lineTotal: 180,
        restock: true,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    returnRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => ({ id: 'ret-1', ...x })),
      findOne: jest.fn(),
    };
    invoiceLineRepo = { save: jest.fn((x) => x) };
    orderLineRepo = { find: jest.fn().mockResolvedValue([{ id: 'ol1', orderId: 'so1' }]) };
    movementRepo = {
      find: jest.fn().mockResolvedValue([
        { referenceId: 'so1', productId: 'p1', quantity: -3, unitCost: 40 },
        { referenceId: 'so1', productId: 'p1', quantity: -2, unitCost: 55 },
      ]),
    };
    invoicesService = {
      findById: jest.fn(async (_t, id) =>
        id === 'inv-1' ? invoice() : { id, totalAmount: 205.2, paidAmount: 0, moveType: SalesInvoiceType.CREDIT_NOTE },
      ),
      create: jest.fn(async (_t, _u, dto, extra) => ({ id: 'cn-1', ...dto, ...extra })),
      post: jest.fn(async () => ({ id: 'cn-1', totalAmount: 205.2, paidAmount: 0 })),
      adjustCustomerBalance: jest.fn(),
      applyPayment: jest.fn(),
    };
    stockService = {
      isStockable: jest.fn().mockResolvedValue(true),
      receive: jest.fn(),
      getUnitCost: jest.fn().mockResolvedValue(70),
    };
    autoPosting = { preflight: jest.fn(), post: jest.fn() };
    service = new SalesReturnsService(
      returnRepo as any,
      { create: jest.fn((x) => x), save: jest.fn((x) => x) } as any,
      invoiceLineRepo as any,
      orderLineRepo as any,
      { findOne: jest.fn().mockResolvedValue({ id: 'c2', salesRepId: null }) } as any,
      movementRepo as any,
      invoicesService as any,
      stockService as any,
      autoPosting as any,
      { next: jest.fn().mockResolvedValue('SRET-1') } as any,
    );
  });

  it('takes prices from the invoice and prorates the discount', async () => {
    await service.create('t1', 'u1', {
      originalInvoiceId: 'inv-1',
      warehouseId: 'wh1',
      lines: [{ invoiceLineId: 'il1', quantity: 2 }],
    });
    const created = returnRepo.create.mock.calls[0][0];
    expect(created.lines[0]).toEqual(
      expect.objectContaining({ unitPrice: 100, discount: 20, lineTotal: 180 }),
    );
    expect(created.totalAmount).toBe(205.2);
  });

  it('refuses quantities above invoiced minus already returned', async () => {
    await expect(
      service.create('t1', 'u1', {
        originalInvoiceId: 'inv-1',
        lines: [{ invoiceLineId: 'il1', quantity: 4 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses returns against draft invoices', async () => {
    invoicesService.findById.mockResolvedValue({ ...invoice(), status: SalesInvoiceStatus.DRAFT });
    await expect(
      service.create('t1', 'u1', { originalInvoiceId: 'inv-1', lines: [{ invoiceLineId: 'il1', quantity: 1 }] }),
    ).rejects.toThrow(ConflictException);
  });

  it('requires explicit prices for returns without an invoice', async () => {
    await expect(
      service.create('t1', 'u1', { customerId: 'c2', lines: [{ productId: 'p1', quantity: 1 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('restocks at the delivery cost, reverses COGS and issues a posted credit note', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draftReturn() as any);

    await service.post('t1', 'u1', 'ret-1');

    // weighted delivery cost: (3 x 40 + 2 x 55) / 5 = 46
    expect(stockService.receive).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ productId: 'p1', warehouseId: 'wh1', quantity: 2, unitCost: 46 }),
    );
    const cogs = autoPosting.post.mock.calls[0][0];
    expect(cogs.buildLines({}, (k: string) => k)).toEqual([
      { accountId: 'inventoryAccountId', debit: 92 },
      { accountId: 'cogsAccountId', credit: 92 },
    ]);
    expect(invoiceLineRepo.save).toHaveBeenCalledWith([expect.objectContaining({ qtyReturned: 4 })]);
    expect(invoicesService.create).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ customerId: 'c1' }),
      expect.objectContaining({
        moveType: SalesInvoiceType.CREDIT_NOTE,
        reversedInvoiceId: 'inv-1',
        salesReturnId: 'ret-1',
      }),
      { skipPriceChecks: true },
    );
    expect(invoicesService.post).toHaveBeenCalledWith('t1', 'u1', 'cn-1');
    expect(returnRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SalesReturnStatus.POSTED, creditNoteId: 'cn-1', costAmount: 92 }),
    );
  });

  it('falls back to the current average cost and pays cash returns out', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(
      draftReturn({
        originalInvoiceId: null,
        refundMethod: ReturnRefundMethod.CASH,
        lines: [{ id: 'rl1', productId: 'p1', quantity: 2, unitPrice: 100, discount: 20, taxRate: 14, restock: true }],
      }) as any,
    );

    await service.post('t1', 'u1', 'ret-1');

    expect(stockService.receive).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ unitCost: 70 }));
    const refund = autoPosting.post.mock.calls[1][0];
    expect(refund.buildLines({}, (k: string) => k)).toEqual([
      { accountId: 'receivableAccountId', debit: 205.2 },
      { accountId: 'cashAccountId', credit: 205.2 },
    ]);
    expect(invoicesService.adjustCustomerBalance).toHaveBeenCalledWith('t1', 'c1', 205.2);
    expect(invoicesService.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'cn-1' }), 205.2);
  });

  it('does not restock damaged goods', async () => {
    const ret = draftReturn();
    ret.lines[0].restock = false;
    jest.spyOn(service, 'findById').mockResolvedValue(ret as any);
    await service.post('t1', 'u1', 'ret-1');
    expect(stockService.receive).not.toHaveBeenCalled();
    expect(autoPosting.post).not.toHaveBeenCalled();
    expect(invoicesService.post).toHaveBeenCalled();
  });
});
