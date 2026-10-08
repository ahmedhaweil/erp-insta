import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Cheque, ChequeStatus, ChequeType } from '../entities/cheque.entity';
import { Treasury, TreasuryType } from '../entities/treasury.entity';
import {
  BounceChequeDto,
  ChequeDueQueryDto,
  ChequeQueryDto,
  DepositChequeDto,
  EndorseChequeDto,
  ReturnChequeDto,
  SettleChequeDto,
} from '../dto/treasury.dto';
import {
  AutoPostingService,
  PostingLine,
  SettingsAccountKey,
} from '@modules/accounting/services/auto-posting.service';
import { AccountingSettings } from '@modules/accounting/entities/accounting-settings.entity';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { PaymentsService } from '@modules/payments/services/payments.service';
import {
  Payment,
  PaymentDirection,
  PaymentMethod,
  PaymentPartnerType,
} from '@modules/payments/entities/payment.entity';
import { SalesInvoicesService } from '@modules/sales/services/sales-invoices.service';
import { round } from '@shared/utils/document-totals.util';
import { TreasuriesService } from './treasuries.service';
import { TreasuryLedgerService } from './treasury-ledger.service';

export const CHEQUE_SOURCE = 'cheque';

/** Statuses in which a cheque is still outstanding (shown in the due calendar). */
export const OPEN_CHEQUE_STATUSES = [
  ChequeStatus.IN_PORTFOLIO,
  ChequeStatus.UNDER_COLLECTION,
  ChequeStatus.ISSUED,
];

/**
 * Cheque / notes lifecycle (أوراق القبض والدفع). Cheques are created by
 * payments of method "cheque" (Dr notes receivable / Cr receivable, or
 * Dr payable / Cr notes payable); this service drives the later steps:
 *
 * Received: deposit (Dr cheques under collection / Cr notes receivable),
 * collect (Dr bank / Cr under collection, or notes receivable when cashed
 * directly), bounce or return (the payment is undone: invoices re-open and
 * the customer owes again; optional bank charge), endorse to a supplier
 * (supplier payment Dr payable / Cr notes receivable).
 * Issued: clear (Dr notes payable / Cr bank), bounce or cancel.
 */
@Injectable()
export class ChequesService {
  constructor(
    @InjectRepository(Cheque)
    private readonly chequeRepo: Repository<Cheque>,
    private readonly treasuries: TreasuriesService,
    private readonly ledger: TreasuryLedgerService,
    private readonly payments: PaymentsService,
    private readonly salesInvoices: SalesInvoicesService,
    private readonly autoPosting: AutoPostingService,
  ) {}

  findAll(tenantId: string, query: ChequeQueryDto = {}) {
    const qb = this.chequeRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .orderBy('c.due_date', 'ASC')
      .addOrderBy('c.created_at', 'ASC');
    if (query.type) qb.andWhere('c.type = :type', { type: query.type });
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.partnerId) qb.andWhere('c.partner_id = :partnerId', { partnerId: query.partnerId });
    if (query.dueFrom) qb.andWhere('c.due_date >= :dueFrom', { dueFrom: query.dueFrom });
    if (query.dueTo) qb.andWhere('c.due_date <= :dueTo', { dueTo: query.dueTo });
    return qb.getMany();
  }

  async findById(tenantId: string, id: string): Promise<Cheque> {
    const cheque = await this.chequeRepo.findOne({ where: { id, tenantId } });
    if (!cheque) throw new NotFoundException('Cheque not found');
    return cheque;
  }

  /** Cheque calendar: outstanding cheques due in a date range, with totals. */
  async due(tenantId: string, query: ChequeDueQueryDto) {
    const where: any = { tenantId, status: In(OPEN_CHEQUE_STATUSES) };
    if (query.type) where.type = query.type;
    const cheques = (
      await this.chequeRepo.find({ where, order: { dueDate: 'ASC', createdAt: 'ASC' } })
    ).filter((c) => c.dueDate >= query.from && c.dueDate <= query.to);

    const sum = (type: ChequeType) =>
      round(
        cheques.filter((c) => c.type === type).reduce((s, c) => s + Number(c.amount), 0),
        4,
      );
    const byDate = new Map<string, { date: string; received: number; issued: number; count: number }>();
    for (const c of cheques) {
      const day = byDate.get(c.dueDate) ?? { date: c.dueDate, received: 0, issued: 0, count: 0 };
      day[c.type === ChequeType.RECEIVED ? 'received' : 'issued'] = round(
        day[c.type === ChequeType.RECEIVED ? 'received' : 'issued'] + Number(c.amount),
        4,
      );
      day.count += 1;
      byDate.set(c.dueDate, day);
    }
    return {
      from: query.from,
      to: query.to,
      totalReceivable: sum(ChequeType.RECEIVED),
      totalPayable: sum(ChequeType.ISSUED),
      days: [...byDate.values()],
      cheques,
    };
  }

  /** Received cheque handed to the bank for collection. */
  async deposit(tenantId: string, userId: string, id: string, dto: DepositChequeDto) {
    const cheque = await this.findById(tenantId, id);
    this.expect(cheque, ChequeType.RECEIVED, [ChequeStatus.IN_PORTFOLIO], 'deposited');
    const bank = await this.bankFor(tenantId, cheque, dto.treasuryId);
    await this.autoPosting.preflight(tenantId, dto.date, [
      'chequesUnderCollectionAccountId',
      'notesReceivableAccountId',
    ]);
    await this.postCheque(tenantId, userId, cheque, dto.date, 'Deposit', (account) => [
      { accountId: account('chequesUnderCollectionAccountId'), debit: Number(cheque.amount) },
      { accountId: account('notesReceivableAccountId'), credit: Number(cheque.amount) },
    ]);
    cheque.treasuryId = bank.id;
    return this.transition(cheque, ChequeStatus.UNDER_COLLECTION, dto.date, 'deposited', userId, dto.note);
  }

  /** Received cheque paid by the drawer's bank (from collection or cashed directly). */
  async collect(tenantId: string, userId: string, id: string, dto: SettleChequeDto) {
    const cheque = await this.findById(tenantId, id);
    this.expect(
      cheque,
      ChequeType.RECEIVED,
      [ChequeStatus.UNDER_COLLECTION, ChequeStatus.IN_PORTFOLIO],
      'collected',
    );
    const fromPortfolio = cheque.status === ChequeStatus.IN_PORTFOLIO;
    const bank = await this.bankFor(tenantId, cheque, dto.treasuryId ?? cheque.treasuryId);
    const sourceKey: SettingsAccountKey = fromPortfolio
      ? 'notesReceivableAccountId'
      : 'chequesUnderCollectionAccountId';
    await this.autoPosting.preflight(tenantId, dto.date, [sourceKey]);
    await this.postCheque(tenantId, userId, cheque, dto.date, 'Collection', (account) => [
      { accountId: bank.accountId, debit: Number(cheque.amount), branchId: bank.branchId ?? undefined },
      { accountId: account(sourceKey), credit: Number(cheque.amount) },
    ]);
    cheque.treasuryId = bank.id;
    return this.transition(cheque, ChequeStatus.COLLECTED, dto.date, 'collected', userId, dto.note);
  }

  /** Issued cheque presented and paid from our bank account. */
  async clear(tenantId: string, userId: string, id: string, dto: SettleChequeDto) {
    const cheque = await this.findById(tenantId, id);
    this.expect(cheque, ChequeType.ISSUED, [ChequeStatus.ISSUED], 'cleared');
    const bank = await this.bankFor(tenantId, cheque, dto.treasuryId ?? cheque.treasuryId);
    await this.autoPosting.preflight(tenantId, dto.date, ['notesPayableAccountId']);
    await this.postCheque(tenantId, userId, cheque, dto.date, 'Clearing', (account) => [
      { accountId: account('notesPayableAccountId'), debit: Number(cheque.amount) },
      { accountId: bank.accountId, credit: Number(cheque.amount), branchId: bank.branchId ?? undefined },
    ]);
    cheque.treasuryId = bank.id;
    return this.transition(cheque, ChequeStatus.CLEARED, dto.date, 'cleared', userId, dto.note);
  }

  /**
   * Bounced cheque. The payment that created it is undone (its entries
   * reversed, invoices re-opened, partner owes again); a deposit entry is
   * reversed too, so the net effect is Dr receivable / Cr notes receivable
   * or cheques under collection. An endorsed cheque returned by the
   * supplier also undoes the endorsement payment. An optional bank charge is
   * posted Dr bank charges (or the customer) / Cr bank.
   */
  async bounce(tenantId: string, userId: string, id: string, dto: BounceChequeDto) {
    const cheque = await this.findById(tenantId, id);
    const allowed =
      cheque.type === ChequeType.RECEIVED
        ? [ChequeStatus.IN_PORTFOLIO, ChequeStatus.UNDER_COLLECTION, ChequeStatus.ENDORSED]
        : [ChequeStatus.ISSUED];
    this.expect(cheque, cheque.type, allowed, 'bounced');

    const charge = round(dto.bankCharge ?? 0, 4);
    let bank: Treasury | null = null;
    if (charge > 0) {
      if (cheque.type !== ChequeType.RECEIVED) {
        throw new BadRequestException('Bank charges on bounced issued cheques: use a payment voucher');
      }
      bank = await this.bankFor(tenantId, cheque, dto.treasuryId ?? cheque.treasuryId);
      if (dto.chargeToCustomer && cheque.partnerType !== PaymentPartnerType.CUSTOMER) {
        throw new BadRequestException('Only customer cheques can be re-charged to the partner');
      }
    }
    await this.autoPosting.preflight(
      tenantId,
      dto.date,
      charge > 0 ? [dto.chargeToCustomer ? 'receivableAccountId' : 'bankChargesAccountId'] : [],
    );

    if (cheque.status === ChequeStatus.UNDER_COLLECTION) {
      await this.ledger.assertNotReconciled(tenantId, CHEQUE_SOURCE, cheque.id);
      await this.autoPosting.reverseSource(tenantId, userId, CHEQUE_SOURCE, cheque.id, dto.date);
    }
    if (cheque.status === ChequeStatus.ENDORSED && cheque.endorsementPaymentId) {
      await this.payments.revertChequePayment(tenantId, userId, cheque.endorsementPaymentId, dto.date);
    }
    await this.payments.revertChequePayment(tenantId, userId, cheque.paymentId, dto.date);

    if (charge > 0 && bank) {
      const toCustomer = !!dto.chargeToCustomer;
      await this.postCheque(tenantId, userId, cheque, dto.date, 'Bounce charge', (account) => [
        {
          accountId: account(toCustomer ? 'receivableAccountId' : 'bankChargesAccountId'),
          debit: charge,
        },
        { accountId: bank!.accountId, credit: charge, branchId: bank!.branchId ?? undefined },
      ]);
      if (toCustomer) {
        await this.salesInvoices.adjustCustomerBalance(tenantId, cheque.partnerId, charge);
      }
    }
    return this.transition(cheque, ChequeStatus.BOUNCED, dto.date, 'bounced', userId, dto.note);
  }

  /** Received cheque handed back to the customer from the portfolio. */
  async returnToPartner(tenantId: string, userId: string, id: string, dto: ReturnChequeDto) {
    const cheque = await this.findById(tenantId, id);
    this.expect(cheque, ChequeType.RECEIVED, [ChequeStatus.IN_PORTFOLIO], 'returned');
    await this.autoPosting.preflight(tenantId, dto.date, []);
    await this.payments.revertChequePayment(tenantId, userId, cheque.paymentId, dto.date);
    return this.transition(cheque, ChequeStatus.RETURNED, dto.date, 'returned', userId, dto.note);
  }

  /** Endorses a received cheque to a supplier: a supplier payment settling its bills. */
  async endorse(tenantId: string, userId: string, id: string, dto: EndorseChequeDto) {
    const cheque = await this.findById(tenantId, id);
    this.expect(cheque, ChequeType.RECEIVED, [ChequeStatus.IN_PORTFOLIO], 'endorsed');
    const payment: Payment = await this.payments.create(tenantId, userId, {
      partnerType: PaymentPartnerType.SUPPLIER,
      partnerId: dto.supplierId,
      direction: PaymentDirection.OUTBOUND,
      amount: Number(cheque.amount),
      date: dto.date,
      method: PaymentMethod.CHEQUE,
      reference: dto.reference ?? `Cheque ${cheque.chequeNumber}`,
      currencyId: cheque.currencyId ?? undefined,
      endorsedChequeId: cheque.id,
      allocations: dto.allocations,
      autoAllocate: dto.autoAllocate,
    });
    return { cheque: await this.findById(tenantId, id), payment };
  }

  /** Cancels a cheque still in the portfolio / not yet presented, with its payment. */
  async cancel(tenantId: string, userId: string, id: string) {
    const cheque = await this.findById(tenantId, id);
    this.expect(
      cheque,
      cheque.type,
      [ChequeStatus.IN_PORTFOLIO, ChequeStatus.ISSUED],
      'cancelled',
    );
    await this.payments.cancel(tenantId, userId, cheque.paymentId);
    return this.findById(tenantId, id);
  }

  private expect(cheque: Cheque, type: ChequeType, statuses: ChequeStatus[], action: string) {
    if (cheque.type !== type) {
      throw new BadRequestException(`A ${cheque.type} cheque cannot be ${action}`);
    }
    if (!statuses.includes(cheque.status)) {
      throw new ConflictException(
        `Cheque ${cheque.chequeNumber} is ${cheque.status} and cannot be ${action}`,
      );
    }
  }

  private async bankFor(tenantId: string, cheque: Cheque, treasuryId?: string): Promise<Treasury> {
    if (!treasuryId) throw new BadRequestException('A bank treasury is required');
    const bank = await this.treasuries.getActive(tenantId, treasuryId, TreasuryType.BANK);
    if ((bank.currencyId ?? null) !== (cheque.currencyId ?? null) && bank.currencyId) {
      throw new BadRequestException(`Bank ${bank.code} holds another currency than the cheque`);
    }
    return bank;
  }

  private postCheque(
    tenantId: string,
    userId: string,
    cheque: Cheque,
    date: string,
    label: string,
    build: (account: (key: SettingsAccountKey) => string, s: AccountingSettings) => PostingLine[],
  ) {
    return this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.BANK,
      date,
      description: `${label} of cheque ${cheque.chequeNumber}${cheque.bankName ? ` (${cheque.bankName})` : ''}`,
      sourceType: CHEQUE_SOURCE,
      sourceId: cheque.id,
      currencyId: cheque.currencyId ?? undefined,
      exchangeRate: Number(cheque.exchangeRate) || 1,
      buildLines: (s, account) => build(account, s),
    });
  }

  private transition(
    cheque: Cheque,
    status: ChequeStatus,
    date: string,
    action: string,
    userId: string,
    note?: string,
  ): Promise<Cheque> {
    cheque.status = status;
    cheque.statusDate = date;
    cheque.history = [...(cheque.history ?? []), { date, action, userId, ...(note ? { note } : {}) }];
    return this.chequeRepo.save(cheque);
  }
}
