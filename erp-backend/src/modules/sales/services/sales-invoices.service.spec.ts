import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SalesInvoicesService } from './sales-invoices.service';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '../entities/sales-invoice.entity';
import { SalesInvoiceLine } from '../entities/sales-invoice-line.entity';
import { Customer } from '../entities/customer.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { SalesPricingService } from './sales-pricing.service';
import { InstallmentScheduleService } from './installment-schedule.service';

describe('SalesInvoicesService', () => {
  let service: SalesInvoicesService;
  let invoiceRepo: Record<string, jest.Mock>;
  let customerRepo: Record<string, any>;
  let autoPosting: Record<string, jest.Mock>;
  let pricing: Record<string, jest.Mock>;
  let installments: Record<string, jest.Mock>;
  let balanceUpdate: {
    set: jest.Mock;
    setParameter: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };

  const customer = {
    id: 'cust-1',
    isActive: true,
    creditLimit: 0,
    balance: 0,
    paymentTermDays: 30,
  };

  const postedInvoice = () => ({
    id: 'inv-1',
    tenantId: 't1',
    invoiceNumber: 'INV-000001',
    customerId: 'cust-1',
    moveType: SalesInvoiceType.INVOICE,
    status: SalesInvoiceStatus.POSTED,
    date: '2026-01-10',
    subtotal: 100,
    taxAmount: 14,
    totalAmount: 114,
    paidAmount: 0,
    exchangeRate: 1,
    lines: [{ id: 'il1', productId: 'p1', quantity: 2, unitPrice: 50, discount: 0, taxRate: 14 }],
  });

  beforeEach(async () => {
    invoiceRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: entity.id ?? 'new-inv', ...entity })),
    };
    balanceUpdate = {
      set: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    customerRepo = {
      findOne: jest.fn().mockResolvedValue(customer),
      createQueryBuilder: jest.fn(() => ({ update: jest.fn(() => balanceUpdate) })),
    };
    autoPosting = {
      post: jest.fn().mockResolvedValue(null),
      reverseSource: jest.fn().mockResolvedValue([]),
      preflight: jest.fn(),
    };

    pricing = {
      priceLines: jest.fn(async (_t, _c, lines) => ({
        lines: lines.map((l: any) => ({ ...l, unitPrice: l.unitPrice ?? 90 })),
        priceListId: 'pl-1',
      })),
      enforceMinPrice: jest.fn(),
      defaultTaxRates: jest.fn(async () => new Map([['prod-1', 14]])),
    };
    installments = { syncInvoice: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesInvoicesService,
        { provide: getRepositoryToken(SalesInvoice), useValue: invoiceRepo },
        { provide: getRepositoryToken(SalesInvoiceLine), useValue: { create: jest.fn((l) => l) } },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue('INV-000001') } },
        { provide: AutoPostingService, useValue: autoPosting },
        { provide: SalesPricingService, useValue: pricing },
        { provide: InstallmentScheduleService, useValue: installments },
      ],
    }).compile();

    service = module.get(SalesInvoicesService);
  });

  it('creates drafts without touching the customer balance and applies payment terms', async () => {
    await service.create('t1', 'u1', {
      customerId: 'cust-1',
      date: '2026-01-10',
      lines: [{ productId: 'p1', quantity: 2, unitPrice: 50, taxRate: 14 }],
    } as any);

    expect(invoiceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SalesInvoiceStatus.DRAFT,
        dueDate: '2026-02-09',
        subtotal: 100,
        taxAmount: 14,
        totalAmount: 114,
      }),
    );
    expect(balanceUpdate.execute).not.toHaveBeenCalled();
  });

  it('posts receivable / revenue / VAT and raises the customer balance', async () => {
    invoiceRepo.findOne.mockResolvedValue({ ...postedInvoice(), status: SalesInvoiceStatus.DRAFT });

    const result = await service.post('t1', 'u1', 'inv-1');

    expect(result.status).toBe(SalesInvoiceStatus.POSTED);
    const request = autoPosting.post.mock.calls[0][0];
    const lines = request.buildLines({}, (key: string) => key);
    expect(lines).toEqual([
      { accountId: 'receivableAccountId', debit: 114 },
      { accountId: 'salesAccountId', credit: 100 },
      { accountId: 'outputTaxAccountId', credit: 14 },
    ]);
    expect(balanceUpdate.setParameter).toHaveBeenCalledWith('delta', 114);
  });

  it('enforces the credit limit when posting', async () => {
    invoiceRepo.findOne.mockResolvedValue({ ...postedInvoice(), status: SalesInvoiceStatus.DRAFT });
    customerRepo.findOne.mockResolvedValue({ ...customer, creditLimit: 100, balance: 0 });

    await expect(service.post('t1', 'u1', 'inv-1')).rejects.toThrow(BadRequestException);
    expect(autoPosting.post).not.toHaveBeenCalled();
  });

  it('records partial payments', async () => {
    const result = await service.applyPayment(postedInvoice() as any, 50);
    expect(result.status).toBe(SalesInvoiceStatus.PARTIAL);
    expect(result.paidAmount).toBe(50);
  });

  it('rejects over-payment of an invoice', async () => {
    await expect(service.applyPayment(postedInvoice() as any, 200)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('cancels a posted unpaid invoice by reversing its entry and balance', async () => {
    invoiceRepo.findOne.mockResolvedValue(postedInvoice());

    const result = await service.cancel('t1', 'u1', 'inv-1');

    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'sales_invoice', 'inv-1');
    expect(balanceUpdate.setParameter).toHaveBeenCalledWith('delta', -114);
    expect(result.status).toBe(SalesInvoiceStatus.CANCELLED);
  });

  it('refuses to cancel a paid invoice', async () => {
    invoiceRepo.findOne.mockResolvedValue({ ...postedInvoice(), paidAmount: 10 });

    await expect(service.cancel('t1', 'u1', 'inv-1')).rejects.toThrow(ConflictException);
  });

  it('issues a partial credit note linked to the original invoice', async () => {
    invoiceRepo.findOne.mockResolvedValue(postedInvoice());

    await service.createCreditNote('t1', 'u1', 'inv-1', {
      lines: [{ invoiceLineId: 'il1', quantity: 1 }],
    });

    expect(invoiceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        moveType: SalesInvoiceType.CREDIT_NOTE,
        reversedInvoiceId: 'inv-1',
        subtotal: 50,
        taxAmount: 7,
        totalAmount: 57,
      }),
    );
  });

  it('prices lines without a unit price from the price list and checks minimum prices', async () => {
    await service.create('t1', 'u1', {
      customerId: 'cust-1',
      date: '2026-01-10',
      lines: [{ productId: 'p1', quantity: 2 }],
    } as any);

    expect(pricing.priceLines).toHaveBeenCalled();
    expect(pricing.enforceMinPrice).toHaveBeenCalledWith('t1', 'u1', [expect.objectContaining({ lineTotal: 180 })], 1);
    expect(invoiceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ priceListId: 'pl-1', subtotal: 180 }),
    );
  });

  it('skips price checks on credit notes', async () => {
    await service.create(
      't1',
      'u1',
      { customerId: 'cust-1', date: '2026-01-10', lines: [{ productId: 'p1', quantity: 1, unitPrice: 1 }] } as any,
      { moveType: SalesInvoiceType.CREDIT_NOTE },
    );
    expect(pricing.enforceMinPrice).not.toHaveBeenCalled();
  });

  it('computes tax-inclusive totals and withholding (line rate overrides document rate)', async () => {
    await service.create('t1', 'u1', {
      customerId: 'cust-1',
      date: '2026-01-10',
      pricesIncludeTax: true,
      withholdingRate: 1,
      lines: [
        { productId: 'p1', quantity: 1, unitPrice: 1140, taxRate: 14, withholdingRate: 3 },
        { productId: 'p2', quantity: 1, unitPrice: 570, taxRate: 14 },
      ],
    } as any);

    expect(invoiceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        pricesIncludeTax: true,
        subtotal: 1500,
        taxAmount: 210,
        totalAmount: 1710,
        withholdingRate: 1,
        withholdingAmount: 35,
        salesRepId: null,
      }),
    );
  });

  it('defaults the sales rep from the customer', async () => {
    customerRepo.findOne.mockResolvedValue({ ...customer, salesRepId: 'rep-1' });
    await service.create('t1', 'u1', {
      customerId: 'cust-1',
      date: '2026-01-10',
      lines: [{ productId: 'p1', quantity: 1, unitPrice: 10 }],
    } as any);
    expect(invoiceRepo.create).toHaveBeenCalledWith(expect.objectContaining({ salesRepId: 'rep-1' }));
  });

  it('posts credit notes to the sales return account when configured', async () => {
    invoiceRepo.findOne.mockResolvedValue({
      ...postedInvoice(),
      status: SalesInvoiceStatus.DRAFT,
      moveType: SalesInvoiceType.CREDIT_NOTE,
    });
    await service.post('t1', 'u1', 'inv-1');
    const request = autoPosting.post.mock.calls[0][0];
    const account = (key: string) => key;
    expect(request.buildLines({ salesReturnAccountId: 'ret-acc' }, account)[0]).toEqual({
      accountId: 'ret-acc',
      debit: 100,
    });
    expect(request.buildLines({}, account)[0]).toEqual({ accountId: 'salesAccountId', debit: 100 });
  });

  it('syncs installments when a payment is applied', async () => {
    await service.applyPayment(postedInvoice() as any, 50);
    expect(installments.syncInvoice).toHaveBeenCalledWith('t1', 'inv-1', 50);
  });
});
