import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { Treasury, TreasuryType } from '@modules/treasury/entities/treasury.entity';
import { Cheque, ChequeStatus, ChequeType } from '@modules/treasury/entities/cheque.entity';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentRepo: Record<string, jest.Mock>;
  let allocationRepo: Record<string, jest.Mock>;
  let salesInvoiceRepo: Record<string, jest.Mock>;
  let salesInvoices: Record<string, jest.Mock>;
  let purchaseInvoices: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let treasuryRepo: Record<string, jest.Mock>;
  let chequeRepo: Record<string, jest.Mock>;
  let supplierRepo: Record<string, jest.Mock>;
  let purchaseInvoiceRepo: Record<string, jest.Mock>;
  let stored: any;
  let cheques: any[];
  let invoices: any[];
  let bills: any[];

  /** Lines built by the n-th posting call, with settings keys as account ids. */
  const postedLines = (n = 0) =>
    autoPosting.post.mock.calls[n][0].buildLines({}, (key: string) => key);

  beforeEach(async () => {
    invoices = [
      { id: 'inv-old', totalAmount: 100, paidAmount: 0, dueDate: '2026-01-01', date: '2026-01-01' },
      { id: 'inv-new', totalAmount: 200, paidAmount: 50, dueDate: '2026-02-01', date: '2026-01-15' },
    ];
    bills = [
      { id: 'bill-1', totalAmount: 1000, paidAmount: 0, dueDate: '2026-02-01', date: '2026-01-10' },
    ];
    stored = null;
    cheques = [];
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
      find: jest.fn(async () => invoices),
      findOne: jest.fn(async ({ where }) => invoices.find((i) => i.id === where.id)),
    };
    purchaseInvoiceRepo = {
      find: jest.fn(async () => bills),
      findOne: jest.fn(async ({ where }) => bills.find((b) => b.id === where.id)),
    };
    supplierRepo = { findOne: jest.fn().mockResolvedValue({ id: 's1' }) };
    treasuryRepo = { findOne: jest.fn() };
    chequeRepo = {
      create: jest.fn((c) => c),
      save: jest.fn(async (c) => {
        if (!c.id) {
          c.id = `chq-${cheques.length + 1}`;
          cheques.push(c);
        }
        return c;
      }),
      findOne: jest.fn(async ({ where }) => cheques.find((c) => c.id === where.id) ?? null),
    };
    salesInvoices = {
      applyPayment: jest.fn(async (doc, amount) => ({
        ...doc,
        paidAmount: doc.paidAmount + amount,
      })),
      adjustCustomerBalance: jest.fn(),
    };
    purchaseInvoices = {
      applyPayment: jest.fn(async (doc, amount) => ({
        ...doc,
        paidAmount: doc.paidAmount + amount,
      })),
      adjustSupplierBalance: jest.fn(),
    };
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
        { provide: getRepositoryToken(Supplier), useValue: supplierRepo },
        { provide: getRepositoryToken(SalesInvoice), useValue: salesInvoiceRepo },
        { provide: getRepositoryToken(PurchaseInvoice), useValue: purchaseInvoiceRepo },
        { provide: getRepositoryToken(Treasury), useValue: treasuryRepo },
        { provide: getRepositoryToken(Cheque), useValue: chequeRepo },
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

    expect(postedLines()).toEqual([
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

  describe('treasuries', () => {
    it('posts to the treasury GL account instead of the default cash account', async () => {
      treasuryRepo.findOne.mockResolvedValue({
        id: 'tr-1',
        code: 'BOX1',
        type: TreasuryType.CASH,
        accountId: 'acc-box1',
        isActive: true,
        branchId: 'br-1',
      });
      const payment = await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 80,
        date: '2026-03-01',
        treasuryId: 'tr-1',
      });

      expect(payment.treasuryId).toBe('tr-1');
      expect(autoPosting.preflight).toHaveBeenCalledWith('t1', '2026-03-01', [
        'receivableAccountId',
      ]);
      expect(postedLines()).toEqual([
        { accountId: 'acc-box1', debit: 80, branchId: 'br-1' },
        { accountId: 'receivableAccountId', credit: 80 },
      ]);
    });

    it('rejects a foreign-currency payment through a base-currency treasury', async () => {
      treasuryRepo.findOne.mockResolvedValue({
        id: 'tr-1',
        code: 'BOX1',
        type: TreasuryType.CASH,
        accountId: 'acc-box1',
        isActive: true,
      });
      await expect(
        service.create('t1', 'u1', {
          partnerType: PaymentPartnerType.CUSTOMER,
          partnerId: 'c1',
          amount: 80,
          date: '2026-03-01',
          treasuryId: 'tr-1',
          currencyId: 'usd',
          exchangeRate: 48,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an inactive treasury', async () => {
      treasuryRepo.findOne.mockResolvedValue({ id: 'tr-1', code: 'BOX1', isActive: false });
      await expect(
        service.create('t1', 'u1', {
          partnerType: PaymentPartnerType.CUSTOMER,
          partnerId: 'c1',
          amount: 80,
          date: '2026-03-01',
          treasuryId: 'tr-1',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('withholding tax', () => {
    it('settles the customer for the gross amount and debits WHT receivable', async () => {
      const payment = await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 99,
        withholdingAmount: 1,
        date: '2026-03-01',
        method: PaymentMethod.BANK,
        allocations: [{ invoiceId: 'inv-old', amount: 100 }],
      });

      expect(payment.allocatedAmount).toBe(100);
      expect(salesInvoices.adjustCustomerBalance).toHaveBeenCalledWith('t1', 'c1', -100);
      expect(autoPosting.preflight.mock.calls[0][2]).toContain('withholdingTaxReceivableAccountId');
      expect(postedLines()).toEqual([
        { accountId: 'bankAccountId', debit: 99 },
        { accountId: 'withholdingTaxReceivableAccountId', debit: 1 },
        { accountId: 'receivableAccountId', credit: 100 },
      ]);
    });

    it('credits WHT payable when we withhold from a supplier', async () => {
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.SUPPLIER,
        partnerId: 's1',
        amount: 990,
        withholdingAmount: 10,
        date: '2026-03-01',
        autoAllocate: true,
      });

      expect(purchaseInvoices.applyPayment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bill-1' }),
        1000,
      );
      expect(purchaseInvoices.adjustSupplierBalance).toHaveBeenCalledWith('t1', 's1', -1000);
      expect(postedLines()).toEqual([
        { accountId: 'payableAccountId', debit: 1000 },
        { accountId: 'cashAccountId', credit: 990 },
        { accountId: 'withholdingTaxPayableAccountId', credit: 10 },
      ]);
    });

    it('refuses withholding tax on refunds', async () => {
      await expect(
        service.create('t1', 'u1', {
          partnerType: PaymentPartnerType.CUSTOMER,
          partnerId: 'c1',
          direction: PaymentDirection.OUTBOUND,
          amount: 50,
          withholdingAmount: 1,
          date: '2026-03-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('settlement discount', () => {
    it('settles invoices for amount + discount allowed and debits the discount account', async () => {
      const payment = await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 95,
        discountAllowed: 5,
        date: '2026-03-01',
        method: PaymentMethod.BANK,
        autoAllocate: true,
      });

      expect(payment.allocatedAmount).toBe(100);
      expect(salesInvoices.applyPayment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inv-old' }),
        100,
      );
      expect(salesInvoices.adjustCustomerBalance).toHaveBeenCalledWith('t1', 'c1', -100);
      expect(autoPosting.preflight.mock.calls[0][2]).toContain('salesDiscountAccountId');
      expect(postedLines()).toEqual([
        { accountId: 'bankAccountId', debit: 95 },
        { accountId: 'salesDiscountAccountId', debit: 5 },
        { accountId: 'receivableAccountId', credit: 100 },
      ]);
    });

    it('credits discount received on supplier payments', async () => {
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.SUPPLIER,
        partnerId: 's1',
        amount: 980,
        discountAllowed: 20,
        date: '2026-03-01',
        autoAllocate: true,
      });

      expect(purchaseInvoices.applyPayment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'bill-1' }),
        1000,
      );
      expect(postedLines()).toEqual([
        { accountId: 'payableAccountId', debit: 1000 },
        { accountId: 'cashAccountId', credit: 980 },
        { accountId: 'purchaseDiscountAccountId', credit: 20 },
      ]);
    });

    it('restores the gross settled amount on cancel', async () => {
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 95,
        discountAllowed: 5,
        date: '2026-03-01',
        allocations: [{ invoiceId: 'inv-old', amount: 100 }],
      });
      await service.cancel('t1', 'u1', 'pay-1');
      expect(salesInvoices.adjustCustomerBalance).toHaveBeenLastCalledWith('t1', 'c1', 100);
      expect(salesInvoices.applyPayment).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'inv-old' }),
        -100,
      );
    });

    it('refuses a discount on refunds', async () => {
      await expect(
        service.create('t1', 'u1', {
          partnerType: PaymentPartnerType.SUPPLIER,
          partnerId: 's1',
          direction: PaymentDirection.INBOUND,
          amount: 50,
          discountAllowed: 1,
          date: '2026-03-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('exchange differences', () => {
    it('computes gains and losses by direction', () => {
      expect(PaymentsService.exchangeDifference(true, 100, 31, 30)).toBe(100);
      expect(PaymentsService.exchangeDifference(true, 100, 29, 30)).toBe(-100);
      expect(PaymentsService.exchangeDifference(false, 100, 31, 30)).toBe(-100);
      expect(PaymentsService.exchangeDifference(false, 100, 29.5, 30)).toBe(50);
    });

    it('posts a realised gain when a customer pays at a higher rate than invoiced', async () => {
      invoices[0].exchangeRate = 30;
      invoices[0].currencyId = 'usd';
      const payment = await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 100,
        date: '2026-03-01',
        currencyId: 'usd',
        exchangeRate: 31,
        method: PaymentMethod.BANK,
        allocations: [{ invoiceId: 'inv-old', amount: 100 }],
      });

      expect(payment.exchangeRate).toBe(31);
      expect(autoPosting.post.mock.calls[0][0].exchangeRate).toBe(31);
      const fx = autoPosting.post.mock.calls[1][0];
      expect(fx.sourceType).toBe('payment');
      expect(fx.exchangeRate).toBeUndefined();
      expect(postedLines(1)).toEqual([
        { accountId: 'fxGainAccountId', credit: 100 },
        { accountId: 'receivableAccountId', debit: 100 },
      ]);
    });

    it('posts a realised loss when a supplier bill is paid at a higher rate', async () => {
      bills[0].exchangeRate = 48;
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.SUPPLIER,
        partnerId: 's1',
        amount: 10,
        date: '2026-03-01',
        exchangeRate: 50,
        allocations: [{ invoiceId: 'bill-1', amount: 10 }],
      });

      expect(postedLines(1)).toEqual([
        { accountId: 'fxLossAccountId', debit: 20 },
        { accountId: 'payableAccountId', credit: 20 },
      ]);
    });

    it('does not post an exchange difference at the same rate', async () => {
      invoices[0].exchangeRate = 30;
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 100,
        date: '2026-03-01',
        exchangeRate: 30,
        allocations: [{ invoiceId: 'inv-old', amount: 100 }],
      });
      expect(autoPosting.post).toHaveBeenCalledTimes(1);
    });

    it('refuses to allocate to a document in another currency', async () => {
      invoices[0].currencyId = 'eur';
      await expect(
        service.create('t1', 'u1', {
          partnerType: PaymentPartnerType.CUSTOMER,
          partnerId: 'c1',
          amount: 100,
          date: '2026-03-01',
          currencyId: 'usd',
          exchangeRate: 31,
          allocations: [{ invoiceId: 'inv-old', amount: 100 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cheques', () => {
    const chequeDetails = { chequeNumber: '123456', bankName: 'NBE', dueDate: '2026-04-01' };

    it('a received cheque posts to notes receivable and creates a cheque in the portfolio', async () => {
      const payment = await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 100,
        date: '2026-03-01',
        method: PaymentMethod.CHEQUE,
        cheque: chequeDetails,
        allocations: [{ invoiceId: 'inv-old', amount: 100 }],
      });

      expect(cheques).toHaveLength(1);
      expect(cheques[0]).toMatchObject({
        type: ChequeType.RECEIVED,
        status: ChequeStatus.IN_PORTFOLIO,
        chequeNumber: '123456',
        dueDate: '2026-04-01',
        amount: 100,
        paymentId: 'pay-1',
      });
      expect(payment.chequeId).toBe('chq-1');
      expect(postedLines()).toEqual([
        { accountId: 'notesReceivableAccountId', debit: 100 },
        { accountId: 'receivableAccountId', credit: 100 },
      ]);
      expect(salesInvoices.applyPayment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inv-old' }),
        100,
      );
    });

    it('an issued cheque credits notes payable', async () => {
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.SUPPLIER,
        partnerId: 's1',
        amount: 300,
        date: '2026-03-01',
        method: PaymentMethod.CHEQUE,
        cheque: chequeDetails,
      });
      expect(cheques[0]).toMatchObject({ type: ChequeType.ISSUED, status: ChequeStatus.ISSUED });
      expect(postedLines()).toEqual([
        { accountId: 'payableAccountId', debit: 300 },
        { accountId: 'notesPayableAccountId', credit: 300 },
      ]);
    });

    it('requires cheque details', async () => {
      await expect(
        service.create('t1', 'u1', {
          partnerType: PaymentPartnerType.CUSTOMER,
          partnerId: 'c1',
          amount: 100,
          date: '2026-03-01',
          method: PaymentMethod.CHEQUE,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('endorsing a received cheque pays the supplier from notes receivable', async () => {
      cheques.push({
        id: 'chq-r',
        type: ChequeType.RECEIVED,
        status: ChequeStatus.IN_PORTFOLIO,
        amount: 400,
        exchangeRate: 1,
        history: [],
      });
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.SUPPLIER,
        partnerId: 's1',
        amount: 400,
        date: '2026-03-05',
        method: PaymentMethod.CHEQUE,
        endorsedChequeId: 'chq-r',
      });
      expect(cheques[0]).toMatchObject({
        status: ChequeStatus.ENDORSED,
        endorsedSupplierId: 's1',
        endorsementPaymentId: 'pay-1',
      });
      expect(postedLines()).toEqual([
        { accountId: 'payableAccountId', debit: 400 },
        { accountId: 'notesReceivableAccountId', credit: 400 },
      ]);
    });

    it('cannot endorse for a different amount', async () => {
      cheques.push({
        id: 'chq-r',
        type: ChequeType.RECEIVED,
        status: ChequeStatus.IN_PORTFOLIO,
        amount: 400,
        history: [],
      });
      await expect(
        service.create('t1', 'u1', {
          partnerType: PaymentPartnerType.SUPPLIER,
          partnerId: 's1',
          amount: 300,
          date: '2026-03-05',
          method: PaymentMethod.CHEQUE,
          endorsedChequeId: 'chq-r',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cancelling a cheque payment cancels the cheque, but not once deposited', async () => {
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 100,
        date: '2026-03-01',
        method: PaymentMethod.CHEQUE,
        cheque: chequeDetails,
      });
      cheques[0].status = ChequeStatus.UNDER_COLLECTION;
      await expect(service.cancel('t1', 'u1', 'pay-1')).rejects.toThrow(ConflictException);

      cheques[0].status = ChequeStatus.IN_PORTFOLIO;
      const cancelled = await service.cancel('t1', 'u1', 'pay-1');
      expect(cancelled.status).toBe(PaymentStatus.CANCELLED);
      expect(cheques[0].status).toBe(ChequeStatus.CANCELLED);
    });

    it('reverting a bounced cheque payment re-opens invoices with a dated reversal', async () => {
      await service.create('t1', 'u1', {
        partnerType: PaymentPartnerType.CUSTOMER,
        partnerId: 'c1',
        amount: 100,
        date: '2026-03-01',
        method: PaymentMethod.CHEQUE,
        cheque: chequeDetails,
        allocations: [{ invoiceId: 'inv-old', amount: 100 }],
      });
      const reverted = await service.revertChequePayment('t1', 'u1', 'pay-1', '2026-04-02');
      expect(reverted.status).toBe(PaymentStatus.BOUNCED);
      expect(autoPosting.reverseSource).toHaveBeenCalledWith(
        't1',
        'u1',
        'payment',
        'pay-1',
        '2026-04-02',
      );
      expect(salesInvoices.applyPayment).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'inv-old' }),
        -100,
      );
      expect(salesInvoices.adjustCustomerBalance).toHaveBeenLastCalledWith('t1', 'c1', 100);
    });
  });
});
