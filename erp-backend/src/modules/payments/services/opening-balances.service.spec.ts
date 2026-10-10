import { BadRequestException, ConflictException } from '@nestjs/common';
import { OpeningBalancesService, openingBalanceLines } from './opening-balances.service';
import { PaymentPartnerType } from '../entities/payment.entity';
import { OpeningBalanceStatus } from '../entities/partner-opening-balance.entity';
import { SalesInvoiceStatus, SalesInvoiceType } from '@modules/sales/entities/sales-invoice.entity';
import {
  PurchaseInvoiceStatus,
  PurchaseInvoiceType,
} from '@modules/purchasing/entities/purchase-invoice.entity';

const C = PaymentPartnerType.CUSTOMER;
const S = PaymentPartnerType.SUPPLIER;

describe('OpeningBalancesService', () => {
  let service: OpeningBalancesService;
  let stored: any;
  let sales: any[];
  let bills: any[];
  let salesInvoices: any;
  let purchaseInvoices: any;
  let autoPosting: any;
  let settings: any;

  beforeEach(() => {
    stored = null;
    sales = [];
    bills = [];
    const docRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => (stored = { ...(stored ?? {}), id: 'ob-1', ...x, lines: x.lines ?? stored?.lines })),
      findOne: jest.fn(async () => stored),
      find: jest.fn(),
    };
    const lineRepo = { create: jest.fn((x) => x), save: jest.fn() };
    const partnerRepo = { find: jest.fn(async ({ where }) => where.id._value.map((id: string) => ({ id }))) };
    const salesRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => {
        if (Array.isArray(x)) return x;
        const item = { id: `si-${sales.length + 1}`, ...x };
        sales.push(item);
        return item;
      }),
      find: jest.fn(async () => sales),
    };
    const billRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => {
        if (Array.isArray(x)) return x;
        const item = { id: `pi-${bills.length + 1}`, ...x };
        bills.push(item);
        return item;
      }),
      find: jest.fn(async () => bills),
    };
    salesInvoices = { adjustCustomerBalance: jest.fn() };
    purchaseInvoices = { adjustSupplierBalance: jest.fn() };
    autoPosting = { preflight: jest.fn(), post: jest.fn(), reverseSource: jest.fn() };
    settings = { find: jest.fn().mockResolvedValue({ openingBalanceEquityAccountId: 'eq' }) };
    service = new OpeningBalancesService(
      docRepo as any,
      lineRepo as any,
      partnerRepo as any,
      partnerRepo as any,
      salesRepo as any,
      billRepo as any,
      salesInvoices,
      purchaseInvoices,
      autoPosting,
      settings,
      { next: jest.fn().mockResolvedValue('OB-000001') } as any,
    );
  });

  it('builds balanced lines against opening equity', () => {
    const lines = openingBalanceLines(
      [
        { partnerType: C, amount: 100 },
        { partnerType: C, amount: -30 },
        { partnerType: S, amount: 50 },
      ],
      { receivable: 'AR', payable: 'AP', equity: 'EQ' },
    );
    expect(lines).toEqual([
      { accountId: 'AR', debit: 100 },
      { accountId: 'AR', credit: 30 },
      { accountId: 'AP', credit: 50 },
      { accountId: 'EQ', credit: 20 },
    ]);
    const debit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(debit).toBe(credit);
  });

  it('posts open items with ageing dates and updates partner balances', async () => {
    await service.create('t1', 'u1', {
      date: '2026-01-01',
      lines: [
        { partnerType: C, partnerId: 'c1', amount: 100, originalDate: '2025-10-01', dueDate: '2025-11-01' },
        { partnerType: C, partnerId: 'c2', amount: -40 },
        { partnerType: S, partnerId: 's1', amount: 70, reference: 'B-9' },
      ],
      post: true,
    });

    expect(autoPosting.preflight.mock.calls[0][2]).toEqual([
      'openingBalanceEquityAccountId',
      'receivableAccountId',
      'payableAccountId',
    ]);
    expect(sales[0]).toEqual(
      expect.objectContaining({
        invoiceNumber: 'OB-000001/1',
        moveType: SalesInvoiceType.INVOICE,
        status: SalesInvoiceStatus.POSTED,
        totalAmount: 100,
        date: '2025-10-01',
        dueDate: '2025-11-01',
        openingBalanceId: 'ob-1',
      }),
    );
    expect(sales[1]).toEqual(
      expect.objectContaining({ moveType: SalesInvoiceType.CREDIT_NOTE, totalAmount: 40, date: '2026-01-01' }),
    );
    expect(bills[0]).toEqual(
      expect.objectContaining({
        moveType: PurchaseInvoiceType.BILL,
        status: PurchaseInvoiceStatus.APPROVED,
        totalAmount: 70,
        supplierReference: 'B-9',
      }),
    );
    expect(salesInvoices.adjustCustomerBalance).toHaveBeenCalledWith('t1', 'c2', -40);
    expect(purchaseInvoices.adjustSupplierBalance).toHaveBeenCalledWith('t1', 's1', 70);
    expect(stored.status).toBe(OpeningBalanceStatus.POSTED);
  });

  it('falls back to retained earnings when no opening equity account is set', async () => {
    settings.find.mockResolvedValue({});
    await service.create('t1', 'u1', { lines: [{ partnerType: S, partnerId: 's1', amount: 5 }], post: true });
    expect(autoPosting.preflight.mock.calls[0][2]).toEqual(['retainedEarningsAccountId', 'payableAccountId']);
  });

  it('rejects zero lines', async () => {
    await expect(
      service.create('t1', 'u1', { lines: [{ partnerType: C, partnerId: 'c1', amount: 0 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('cancels only while the open items are untouched', async () => {
    await service.create('t1', 'u1', { lines: [{ partnerType: C, partnerId: 'c1', amount: 100 }], post: true });
    sales[0].paidAmount = 10;
    await expect(service.cancel('t1', 'u1', 'ob-1')).rejects.toThrow(ConflictException);

    sales[0].paidAmount = 0;
    await service.cancel('t1', 'u1', 'ob-1');
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'partner_opening_balance', 'ob-1');
    expect(sales[0].status).toBe(SalesInvoiceStatus.CANCELLED);
    expect(salesInvoices.adjustCustomerBalance).toHaveBeenLastCalledWith('t1', 'c1', -100);
    expect(stored.status).toBe(OpeningBalanceStatus.CANCELLED);
  });
});
