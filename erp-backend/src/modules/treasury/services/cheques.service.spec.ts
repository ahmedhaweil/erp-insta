import { BadRequestException, ConflictException } from '@nestjs/common';
import { ChequesService } from './cheques.service';
import { ChequeStatus, ChequeType } from '../entities/cheque.entity';
import { TreasuryType } from '../entities/treasury.entity';
import { PaymentMethod, PaymentPartnerType } from '@modules/payments/entities/payment.entity';

describe('ChequesService', () => {
  let service: ChequesService;
  let cheque: any;
  let autoPosting: Record<string, jest.Mock>;
  let payments: Record<string, jest.Mock>;
  let salesInvoices: Record<string, jest.Mock>;
  let ledger: Record<string, jest.Mock>;
  const bank = {
    id: 'bank',
    code: 'NBE',
    type: TreasuryType.BANK,
    accountId: 'acc-bank',
    currencyId: null,
    isActive: true,
  };

  const lines = (n = 0) => autoPosting.post.mock.calls[n][0].buildLines({}, (k: string) => k);

  beforeEach(() => {
    cheque = {
      id: 'chq-1',
      type: ChequeType.RECEIVED,
      status: ChequeStatus.IN_PORTFOLIO,
      chequeNumber: '1001',
      amount: 5000,
      exchangeRate: 1,
      currencyId: null,
      partnerType: PaymentPartnerType.CUSTOMER,
      partnerId: 'c1',
      paymentId: 'pay-1',
      dueDate: '2026-04-01',
      history: [],
    };
    const repo = {
      findOne: jest.fn(async () => cheque),
      save: jest.fn(async (c) => c),
      find: jest.fn(async () => [cheque]),
    };
    autoPosting = { post: jest.fn(), preflight: jest.fn(), reverseSource: jest.fn() };
    payments = {
      revertChequePayment: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'pay-2' }),
      cancel: jest.fn(),
    };
    salesInvoices = { adjustCustomerBalance: jest.fn() };
    ledger = { assertNotReconciled: jest.fn() };
    service = new ChequesService(
      repo as any,
      {
        getActive: jest.fn().mockResolvedValue(bank),
        getUsable: jest.fn().mockResolvedValue(bank),
        assertFunds: jest.fn(),
        findById: jest.fn().mockResolvedValue(bank),
      } as any,
      ledger as any,
      payments as any,
      salesInvoices as any,
      autoPosting as any,
    );
  });

  it('deposit moves the cheque from notes receivable to cheques under collection', async () => {
    const result = await service.deposit('t1', 'u1', 'chq-1', {
      treasuryId: 'bank',
      date: '2026-03-30',
    });
    expect(result.status).toBe(ChequeStatus.UNDER_COLLECTION);
    expect(result.treasuryId).toBe('bank');
    expect(result.history[0]).toMatchObject({ action: 'deposited', date: '2026-03-30' });
    expect(autoPosting.post.mock.calls[0][0].sourceType).toBe('cheque');
    expect(lines()).toEqual([
      { accountId: 'chequesUnderCollectionAccountId', debit: 5000 },
      { accountId: 'notesReceivableAccountId', credit: 5000 },
    ]);
  });

  it('collection debits the bank and credits cheques under collection', async () => {
    cheque.status = ChequeStatus.UNDER_COLLECTION;
    cheque.treasuryId = 'bank';
    const result = await service.collect('t1', 'u1', 'chq-1', { date: '2026-04-02' });
    expect(result.status).toBe(ChequeStatus.COLLECTED);
    expect(lines()).toEqual([
      { accountId: 'acc-bank', debit: 5000, branchId: undefined },
      { accountId: 'chequesUnderCollectionAccountId', credit: 5000 },
    ]);
  });

  it('a cheque cashed directly from the portfolio credits notes receivable', async () => {
    await service.collect('t1', 'u1', 'chq-1', { date: '2026-04-02', treasuryId: 'bank' });
    expect(lines()[1]).toEqual({ accountId: 'notesReceivableAccountId', credit: 5000 });
  });

  it('cannot collect without a bank', async () => {
    await expect(service.collect('t1', 'u1', 'chq-1', { date: '2026-04-02' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('bounce after deposit reverses the deposit and the payment, with a bank charge', async () => {
    cheque.status = ChequeStatus.UNDER_COLLECTION;
    cheque.treasuryId = 'bank';
    const result = await service.bounce('t1', 'u1', 'chq-1', {
      date: '2026-04-03',
      bankCharge: 25,
    });
    expect(result.status).toBe(ChequeStatus.BOUNCED);
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'cheque', 'chq-1', '2026-04-03');
    expect(payments.revertChequePayment).toHaveBeenCalledWith('t1', 'u1', 'pay-1', '2026-04-03');
    expect(lines()).toEqual([
      { accountId: 'bankChargesAccountId', debit: 25 },
      { accountId: 'acc-bank', credit: 25, branchId: undefined },
    ]);
    expect(salesInvoices.adjustCustomerBalance).not.toHaveBeenCalled();
  });

  it('a bounce charge can be re-charged to the customer', async () => {
    cheque.status = ChequeStatus.UNDER_COLLECTION;
    cheque.treasuryId = 'bank';
    await service.bounce('t1', 'u1', 'chq-1', {
      date: '2026-04-03',
      bankCharge: 25,
      chargeToCustomer: true,
    });
    expect(lines()[0]).toEqual({ accountId: 'receivableAccountId', debit: 25 });
    expect(salesInvoices.adjustCustomerBalance).toHaveBeenCalledWith('t1', 'c1', 25);
  });

  it('bouncing an endorsed cheque also undoes the endorsement payment', async () => {
    cheque.status = ChequeStatus.ENDORSED;
    cheque.endorsementPaymentId = 'pay-sup';
    await service.bounce('t1', 'u1', 'chq-1', { date: '2026-04-03' });
    expect(payments.revertChequePayment).toHaveBeenNthCalledWith(1, 't1', 'u1', 'pay-sup', '2026-04-03');
    expect(payments.revertChequePayment).toHaveBeenNthCalledWith(2, 't1', 'u1', 'pay-1', '2026-04-03');
    expect(autoPosting.reverseSource).not.toHaveBeenCalled();
  });

  it('cannot bounce a collected cheque', async () => {
    cheque.status = ChequeStatus.COLLECTED;
    await expect(service.bounce('t1', 'u1', 'chq-1', { date: '2026-04-03' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('return to customer undoes the payment', async () => {
    const result = await service.returnToPartner('t1', 'u1', 'chq-1', { date: '2026-03-10' });
    expect(result.status).toBe(ChequeStatus.RETURNED);
    expect(payments.revertChequePayment).toHaveBeenCalledWith('t1', 'u1', 'pay-1', '2026-03-10');
  });

  it('endorsement creates a supplier cheque payment for the full amount', async () => {
    await service.endorse('t1', 'u1', 'chq-1', {
      supplierId: 's1',
      date: '2026-03-15',
      autoAllocate: true,
    });
    expect(payments.create).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({
        partnerType: PaymentPartnerType.SUPPLIER,
        partnerId: 's1',
        amount: 5000,
        method: PaymentMethod.CHEQUE,
        endorsedChequeId: 'chq-1',
        autoAllocate: true,
      }),
    );
  });

  it('issued cheque clearing debits notes payable and credits the bank', async () => {
    cheque.type = ChequeType.ISSUED;
    cheque.status = ChequeStatus.ISSUED;
    cheque.treasuryId = 'bank';
    const result = await service.clear('t1', 'u1', 'chq-1', { date: '2026-04-01' });
    expect(result.status).toBe(ChequeStatus.CLEARED);
    expect(lines()).toEqual([
      { accountId: 'notesPayableAccountId', debit: 5000 },
      { accountId: 'acc-bank', credit: 5000, branchId: undefined },
    ]);
  });

  it('a received cheque cannot be cleared', async () => {
    await expect(
      service.clear('t1', 'u1', 'chq-1', { date: '2026-04-01', treasuryId: 'bank' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('collects a foreign cheque at the collection rate and posts the FX gain', async () => {
    Object.assign(cheque, { currencyId: 'usd', exchangeRate: 48, status: ChequeStatus.UNDER_COLLECTION, treasuryId: 'bank' });
    await service.collect('t1', 'u1', 'chq-1', { date: '2026-04-01', exchangeRate: 50 });
    expect(autoPosting.preflight).toHaveBeenCalledWith(
      't1',
      '2026-04-01',
      expect.arrayContaining(['chequesUnderCollectionAccountId', 'fxGainAccountId', 'fxLossAccountId']),
    );
    const request = autoPosting.post.mock.calls[0][0];
    expect(request).toMatchObject({ currencyId: 'usd', exchangeRate: 1 });
    expect(lines()).toEqual([
      { accountId: 'acc-bank', debit: 250000, amountCurrency: 5000, branchId: undefined },
      { accountId: 'chequesUnderCollectionAccountId', credit: 240000, amountCurrency: -5000 },
      { accountId: 'fxGainAccountId', credit: 10000 },
    ]);
  });

  it('collects at a lower rate with an FX loss, and at the booked rate without FX', async () => {
    Object.assign(cheque, { currencyId: 'usd', exchangeRate: 48 });
    await service.collect('t1', 'u1', 'chq-1', { date: '2026-04-01', treasuryId: 'bank', exchangeRate: 47.5 });
    expect(lines()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 'notesReceivableAccountId', credit: 240000 }),
        { accountId: 'fxLossAccountId', debit: 2500 },
      ]),
    );
    cheque.status = ChequeStatus.IN_PORTFOLIO;
    await service.collect('t1', 'u1', 'chq-1', { date: '2026-04-02', treasuryId: 'bank' });
    expect(lines(1)).toHaveLength(2);
  });

  it('clears a foreign issued cheque: paying more than booked is an FX loss', async () => {
    Object.assign(cheque, {
      type: ChequeType.ISSUED,
      status: ChequeStatus.ISSUED,
      treasuryId: 'bank',
      currencyId: 'usd',
      exchangeRate: 48,
    });
    await service.clear('t1', 'u1', 'chq-1', { date: '2026-04-01', exchangeRate: 49 });
    const posted = lines();
    expect(posted).toEqual([
      { accountId: 'notesPayableAccountId', debit: 240000, amountCurrency: 5000 },
      { accountId: 'acc-bank', credit: 245000, amountCurrency: -5000, branchId: undefined },
      { accountId: 'fxLossAccountId', debit: 5000 },
    ]);
  });

  it('refuses an exchange rate on a base-currency cheque', async () => {
    await expect(
      service.collect('t1', 'u1', 'chq-1', { date: '2026-04-01', treasuryId: 'bank', exchangeRate: 2 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('posts bank charges on a bounced issued cheque', async () => {
    Object.assign(cheque, {
      type: ChequeType.ISSUED,
      status: ChequeStatus.ISSUED,
      treasuryId: 'bank',
      partnerType: PaymentPartnerType.SUPPLIER,
    });
    await service.bounce('t1', 'u1', 'chq-1', { date: '2026-04-02', bankCharge: 75 });
    expect(payments.revertChequePayment).toHaveBeenCalledWith('t1', 'u1', 'pay-1', '2026-04-02');
    expect(lines()).toEqual([
      { accountId: 'bankChargesAccountId', debit: 75 },
      { accountId: 'acc-bank', credit: 75, branchId: undefined },
    ]);
    cheque.status = ChequeStatus.ISSUED;
    await expect(
      service.bounce('t1', 'u1', 'chq-1', { date: '2026-04-02', bankCharge: 75, chargeToCustomer: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lists post-dated cheque reminders per treasury, with overdue ones', async () => {
    const issued = {
      ...cheque,
      id: 'chq-2',
      type: ChequeType.ISSUED,
      status: ChequeStatus.ISSUED,
      treasuryId: 'bank',
      amount: 3000,
      dueDate: '2026-03-28',
    };
    const later = { ...cheque, id: 'chq-3', dueDate: '2026-05-30' };
    (service as any).chequeRepo.find = jest.fn(async () => [issued, cheque, later]);
    const result = await service.reminders('t1', { asOf: '2026-03-30', days: 7 });
    expect(result).toMatchObject({ until: '2026-04-06', count: 2, overdue: 1, totalReceivable: 5000, totalPayable: 3000 });
    const bankGroup = result.treasuries.find((g: any) => g.treasuryId === 'bank');
    expect(bankGroup).toMatchObject({ treasuryCode: 'NBE', issued: 3000, overdue: 1 });
    expect(bankGroup.cheques[0]).toMatchObject({ daysToDue: -2, overdue: true });
    const portfolio = result.treasuries.find((g: any) => g.treasuryId === null);
    expect(portfolio.cheques[0]).toMatchObject({ id: 'chq-1', daysToDue: 2 });
    const upcoming = await service.reminders('t1', { asOf: '2026-03-30', days: 7, includeOverdue: 'false' });
    expect(upcoming.count).toBe(1);
  });

  it('due lists outstanding cheques in the range with totals per day', async () => {
    const result = await service.due('t1', { from: '2026-04-01', to: '2026-04-30' });
    expect(result.totalReceivable).toBe(5000);
    expect(result.totalPayable).toBe(0);
    expect(result.days).toEqual([{ date: '2026-04-01', received: 5000, issued: 0, count: 1 }]);
    const none = await service.due('t1', { from: '2026-05-01', to: '2026-05-31' });
    expect(none.cheques).toHaveLength(0);
  });
});
