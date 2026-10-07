import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import {
  Payment,
  PaymentDirection,
  PaymentMethod,
  PaymentPartnerType,
  PaymentStatus,
} from '../entities/payment.entity';
import { PaymentAllocation } from '../entities/payment-allocation.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoice } from '@modules/purchasing/entities/purchase-invoice.entity';
import { SalesInvoicesService } from '@modules/sales/services/sales-invoices.service';
import { PurchaseInvoicesService } from '@modules/purchasing/services/purchase-invoices.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { SequenceService } from '@shared/services/sequence.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentRepo: Record<string, jest.Mock>;
  let allocationRepo: Record<string, jest.Mock>;
  let salesInvoiceRepo: Record<string, jest.Mock>;
  let salesInvoices: Record<string, jest.Mock>;
  let purchaseInvoices: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let stored: any;

  const invoices = [
    { id: 'inv-old', totalAmount: 100, paidAmount: 0, dueDate: '2026-01-01' },
    { id: 'inv-new', totalAmount: 200, paidAmount: 50, dueDate: '2026-02-01' },
  ];

  beforeEach(async () => {
    stored = null;
    paymentRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (p) => (stored = { id: 'pay-1', allocations: [], ...p })),
      findOne: jest.fn(async () => stored),
      update: jest.fn(async (_id, patch) => Object.assign(stored, patch)),
      find: jest.fn(),
    };
    allocationRepo = {
      create: jest.fn((a) => a),
      save: jest.fn(async (a) => stored.allocations.push(a)),
      delete: jest.fn(),
    };
    salesInvoiceRepo = {
      find: jest.fn().mockResolvedValue(invoices),
      findOne: jest.fn(async ({ where }) => invoices.find((i) => i.id === where.id)),
    };
    salesInvoices = {
      applyPayment: jest.fn(async (doc, amount) => ({
        ...doc,
        paidAmount: doc.paidAmount + amount,
      })),
      adjustCustomerBalance: jest.fn(),
    };
    purchaseInvoices = { applyPayment: jest.fn(), adjustSupplierBalance: jest.fn() };
    autoPosting = {
      post: jest.fn().mockResolvedValue(null),
      reverseSource: jest.fn(),
      preflight: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(PaymentAllocation), useValue: allocationRepo },
        {
          provide: getRepositoryToken(Customer),
          useValue: { findOne: jest.fn().mockResolvedValue({ id: 'c1' }) },
        },
        { provide: getRepositoryToken(Supplier), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(SalesInvoice), useValue: salesInvoiceRepo },
        {
          provide: getRepositoryToken(PurchaseInvoice),
          useValue: { find: jest.fn(), findOne: jest.fn() },
        },
        { provide: SalesInvoicesService, useValue: salesInvoices },
        { provide: PurchaseInvoicesService, useValue: purchaseInvoices },
        { provide: AutoPostingService, useValue: autoPosting },
        {
          provide: SequenceService,
          useValue: { next: jest.fn().mockResolvedValue('PAY-IN-000001') },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('allocates a customer receipt to the oldest invoices first', async () => {
    const payment = await service.create('t1', 'u1', {
      partnerType: PaymentPartnerType.CUSTOMER,
      partnerId: 'c1',
      amount: 150,
      date: '2026-03-01',
      method: PaymentMethod.BANK,
      autoAllocate: true,
    });

    expect(payment.direction).toBe(PaymentDirection.INBOUND);
    expect(salesInvoices.applyPayment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'inv-old' }),
      100,
    );
    expect(salesInvoices.applyPayment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'inv-new' }),
      50,
    );
    expect(payment.allocatedAmount).toBe(150);
    expect(salesInvoices.adjustCustomerBalance).toHaveBeenCalledWith('t1', 'c1', -150);

    const lines = autoPosting.post.mock.calls[0][0].buildLines({}, (key: string) => key);
    expect(lines).toEqual([
      { accountId: 'bankAccountId', debit: 150 },
      { accountId: 'receivableAccountId', credit: 150 },
    ]);
  });

  it('keeps the unallocated remainder as a customer advance', async () => {
    const payment = await service.create('t1', 'u1', {
      partnerType: PaymentPartnerType.CUSTOMER,
      partnerId: 'c1',
      amount: 500,
      date: '2026-03-01',
      autoAllocate: true,
    });

    expect(payment.allocatedAmount).toBe(250);
    expect(payment.amount).toBe(500);
  });

  it('rejects allocations larger than the payment', async () => {
    await expect(
      service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 10,
        date: '2026-03-01',
        allocations: [{ invoiceId: 'inv-old', amount: 20 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('cancelling un-reconciles invoices, reverses the entry and restores the balance', async () => {
    await service.create('t1', 'u1', {
      partnerType: PaymentPartnerType.CUSTOMER,
      partnerId: 'c1',
      amount: 100,
      date: '2026-03-01',
      allocations: [{ invoiceId: 'inv-old', amount: 100 }],
    });

    const cancelled = await service.cancel('t1', 'u1', 'pay-1');

    expect(salesInvoices.applyPayment).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'inv-old' }),
      -100,
    );
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'payment', 'pay-1');
    expect(salesInvoices.adjustCustomerBalance).toHaveBeenLastCalledWith('t1', 'c1', 100);
    expect(cancelled.status).toBe(PaymentStatus.CANCELLED);
  });
});
