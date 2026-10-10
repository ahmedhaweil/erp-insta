import { BadRequestException, ConflictException } from '@nestjs/common';
import { WriteOffsService, allocateOldestFirst, writeOffAccountKey } from './write-offs.service';
import { PaymentPartnerType } from '../entities/payment.entity';
import { WriteOffKind, WriteOffStatus } from '../entities/partner-write-off.entity';

describe('WriteOffsService', () => {
  let service: WriteOffsService;
  let stored: any;
  let invoices: any[];
  let payments: any;
  let salesInvoices: any;
  let purchaseInvoices: any;
  let autoPosting: any;
  let accountRepo: any;

  const lines = (n = 0) => autoPosting.post.mock.calls[n][0].buildLines({}, (k: string) => k);

  beforeEach(() => {
    stored = null;
    invoices = [
      { id: 'i1', invoiceNumber: 'INV-1', totalAmount: 100, paidAmount: 90, exchangeRate: 1 },
      { id: 'i2', invoiceNumber: 'INV-2', totalAmount: 50, paidAmount: 0, exchangeRate: 1 },
    ];
    const writeOffRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => {
        stored = { ...(stored ?? {}), id: 'wo-1', ...x, lines: x.lines ?? stored?.lines };
        return stored;
      }),
      findOne: jest.fn(async () => stored),
      find: jest.fn(),
    };
    const lineRepo = { create: jest.fn((x) => x) };
    const partnerRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1' }) };
    const docRepo = { findOne: jest.fn(async ({ where }) => invoices.find((i) => i.id === where.id)) };
    accountRepo = { findOne: jest.fn() };
    payments = { openDocuments: jest.fn(async () => invoices) };
    salesInvoices = { applyPayment: jest.fn(), adjustCustomerBalance: jest.fn() };
    purchaseInvoices = { applyPayment: jest.fn(), adjustSupplierBalance: jest.fn() };
    autoPosting = { preflight: jest.fn(), post: jest.fn(), reverseSource: jest.fn() };
    service = new WriteOffsService(
      writeOffRepo as any,
      lineRepo as any,
      partnerRepo as any,
      partnerRepo as any,
      docRepo as any,
      docRepo as any,
      accountRepo,
      payments,
      salesInvoices,
      purchaseInvoices,
      autoPosting,
      { next: jest.fn().mockResolvedValue('WO-000001') } as any,
    );
  });

  it('maps kinds to settings accounts per partner type', () => {
    expect(writeOffAccountKey(PaymentPartnerType.CUSTOMER, WriteOffKind.WRITE_OFF)).toBe('badDebtExpenseAccountId');
    expect(writeOffAccountKey(PaymentPartnerType.CUSTOMER, WriteOffKind.DISCOUNT)).toBe('salesDiscountAccountId');
    expect(writeOffAccountKey(PaymentPartnerType.SUPPLIER, WriteOffKind.WRITE_OFF)).toBe('writeOffIncomeAccountId');
    expect(writeOffAccountKey(PaymentPartnerType.SUPPLIER, WriteOffKind.DISCOUNT)).toBe('purchaseDiscountAccountId');
    expect(writeOffAccountKey(PaymentPartnerType.SUPPLIER, WriteOffKind.CUSTOM)).toBeNull();
  });

  it('allocates oldest first and rejects amounts above the open balance', () => {
    expect(allocateOldestFirst(invoices)).toEqual([
      { invoiceId: 'i1', amount: 10 },
      { invoiceId: 'i2', amount: 50 },
    ]);
    expect(allocateOldestFirst(invoices, 15)).toEqual([
      { invoiceId: 'i1', amount: 10 },
      { invoiceId: 'i2', amount: 5 },
    ]);
    expect(() => allocateOldestFirst(invoices, 61)).toThrow(BadRequestException);
  });

  it('creates a draft for the whole residual and posts bad debt against receivable', async () => {
    const wo = await service.create('t1', 'u1', PaymentPartnerType.CUSTOMER, { partnerId: 'c1' });
    expect(wo.status).toBe(WriteOffStatus.DRAFT);
    expect(wo.amount).toBe(60);
    expect(autoPosting.post).not.toHaveBeenCalled();

    await service.post('t1', 'u1', PaymentPartnerType.CUSTOMER, 'wo-1');
    expect(autoPosting.preflight.mock.calls[0][2]).toEqual(['receivableAccountId', 'badDebtExpenseAccountId']);
    expect(lines()).toEqual([
      { accountId: 'badDebtExpenseAccountId', debit: 60 },
      { accountId: 'receivableAccountId', credit: 60 },
    ]);
    expect(salesInvoices.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), 10);
    expect(salesInvoices.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'i2' }), 50);
    expect(salesInvoices.adjustCustomerBalance).toHaveBeenCalledWith('t1', 'c1', -60);
    expect(stored.status).toBe(WriteOffStatus.POSTED);
  });

  it('posts supplier write-offs as Dr payable / Cr income', async () => {
    await service.create('t1', 'u1', PaymentPartnerType.SUPPLIER, {
      partnerId: 's1',
      lines: [{ invoiceId: 'i2', amount: 20 }],
      post: true,
    });
    expect(lines()).toEqual([
      { accountId: 'payableAccountId', debit: 20 },
      { accountId: 'writeOffIncomeAccountId', credit: 20 },
    ]);
    expect(purchaseInvoices.adjustSupplierBalance).toHaveBeenCalledWith('t1', 's1', -20);
  });

  it('rejects lines above the residual or on documents that are not open', async () => {
    await expect(
      service.create('t1', 'u1', PaymentPartnerType.CUSTOMER, {
        partnerId: 'c1',
        lines: [{ invoiceId: 'i1', amount: 11 }],
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.create('t1', 'u1', PaymentPartnerType.CUSTOMER, {
        partnerId: 'c1',
        lines: [{ invoiceId: 'other', amount: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('requires an account for custom write-offs', async () => {
    await expect(
      service.create('t1', 'u1', PaymentPartnerType.CUSTOMER, { partnerId: 'c1', kind: WriteOffKind.CUSTOM }),
    ).rejects.toThrow(BadRequestException);
  });

  it('re-validates residuals at posting time', async () => {
    await service.create('t1', 'u1', PaymentPartnerType.CUSTOMER, { partnerId: 'c1' });
    invoices[0].paidAmount = 100; // settled meanwhile
    await expect(service.post('t1', 'u1', PaymentPartnerType.CUSTOMER, 'wo-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('cancelling a posted write-off reverses it and re-opens the documents', async () => {
    await service.create('t1', 'u1', PaymentPartnerType.CUSTOMER, { partnerId: 'c1', post: true });
    await service.cancel('t1', 'u1', PaymentPartnerType.CUSTOMER, 'wo-1');
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'partner_write_off', 'wo-1');
    expect(salesInvoices.applyPayment).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'i2' }), -50);
    expect(salesInvoices.adjustCustomerBalance).toHaveBeenLastCalledWith('t1', 'c1', 60);
    expect(stored.status).toBe(WriteOffStatus.CANCELLED);
    await expect(service.cancel('t1', 'u1', PaymentPartnerType.CUSTOMER, 'wo-1')).rejects.toThrow(
      ConflictException,
    );
  });
});
