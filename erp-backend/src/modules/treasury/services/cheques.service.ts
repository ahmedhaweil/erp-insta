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
  ChequeReminderQueryDto,
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
import { addDays, round, today } from '@shared/utils/document-totals.util';
import { TreasuriesService } from './treasuries.service';
import { TreasuryLedgerService } from './treasury-ledger.service';

export const CHEQUE_SOURCE = 'cheque';

export interface ChequeSettlementInput {
  kind: 'collect' | 'clear';
  amount: number;
  /** Rate the note was booked at (cheque.exchangeRate). */
  bookedRate: number;
  /** Rate at collection / clearing. */
  settleRate: number;
  foreign: boolean;
  bankAccountId: string;
  bankBranchId?: string;
  notesAccountId: string;
  fxGainAccountId?: string;
  fxLossAccountId?: string;
}

/**
 * Base-currency lines of a cheque collection (Dr bank / Cr notes) or
 * clearing (Dr notes payable / Cr bank). The notes leave at the booked rate
 * and the bank moves at the settlement rate; the difference is a realised
 * exchange gain or loss.
 */
export function chequeSettlementLines(input: ChequeSettlementInput): PostingLine[] {
  const amount = Number(input.amount);
  const notesBase = round(amount * input.bookedRate, 2);
  const bankBase = round(amount * input.settleRate, 2);
  const cur = (v: number) => (input.foreign ? v : undefined);
  const bank = { accountId: input.bankAccountId, branchId: input.bankBranchId };
  const lines: PostingLine[] = [];
  if (input.kind === 'collect') {
    lines.push(
      { ...bank, debit: bankBase, amountCurrency: cur(amount) },
      { accountId: input.notesAccountId, credit: notesBase, amountCurrency: cur(-amount) },
    );
    const diff = round(bankBase - notesBase, 2);
    if (diff > 0) lines.push({ accountId: input.fxGainAccountId as string, credit: diff });
    if (diff < 0) lines.push({ accountId: input.fxLossAccountId as string, debit: -diff });
  } else {
    lines.push(
      { accountId: input.notesAccountId, debit: notesBase, amountCurrency: cur(amount) },
      { ...bank, credit: bankBase, amountCurrency: cur(-amount) },
    );
    const diff = round(bankBase - notesBase, 2);
    if (diff > 0) lines.push({ accountId: input.fxLossAccountId as string, debit: diff });
    if (diff < 0) lines.push({ accountId: input.fxGainAccountId as string, credit: -diff });
  }
  return lines;
}

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

  /**
   * Post-dated cheque reminders (for the alerts module): open cheques due
   * within `days` of `asOf` (and overdue ones), grouped per treasury.
   * Received cheques still in the portfolio have no treasury yet.
   */
  async reminders(tenantId: string, query: ChequeReminderQueryDto = {}) {
    const asOf = query.asOf ?? today();
    const days = query.days ?? 7;
    const until = addDays(asOf, days);
    const includeOverdue = query.includeOverdue !== 'false';
    const where: any = { tenantId, status: In(OPEN_CHEQUE_STATUSES) };
    if (query.type) where.type = query.type;
    if (query.treasuryId) where.treasuryId = query.treasuryId;
    const cheques = (
      await this.chequeRepo.find({ where, order: { dueDate: 'ASC', createdAt: 'ASC' } })
    ).filter((c) => String(c.dueDate) <= until && (includeOverdue || String(c.dueDate) >= asOf));

    const dayDiff = (a: string, b: string) =>
      Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
    const treasuryIds = [...new Set(cheques.map((c) => c.treasuryId).filter(Boolean))];
    const treasuries = new Map<string, Treasury>();
    for (const id of treasuryIds) treasuries.set(id, await this.treasuries.findById(tenantId, id));

    const groups = new Map<string, any>();
    for (const c of cheques) {
      const key = c.treasuryId ?? 'portfolio';
      const t = c.treasuryId ? treasuries.get(c.treasuryId) : undefined;
      const group =
        groups.get(key) ??
        {
          treasuryId: c.treasuryId ?? null,
          treasuryCode: t?.code ?? null,
          treasuryName: t?.nameAr ?? null,
          custodianUserId: t?.custodianUserId ?? null,
          received: 0,
          issued: 0,
          overdue: 0,
          count: 0,
          cheques: [] as any[],
        };
      const daysToDue = dayDiff(String(c.dueDate), asOf);
      group[c.type === ChequeType.RECEIVED ? 'received' : 'issued'] = round(
        group[c.type === ChequeType.RECEIVED ? 'received' : 'issued'] + Number(c.amount),
        4,
      );
      if (daysToDue < 0) group.overdue += 1;
      group.count += 1;
      group.cheques.push({
        id: c.id,
        type: c.type,
        status: c.status,
        chequeNumber: c.chequeNumber,
        bankName: c.bankName,
        partnerType: c.partnerType,
        partnerId: c.partnerId,
        amount: Number(c.amount),
        currencyId: c.currencyId ?? null,
        dueDate: c.dueDate,
        daysToDue,
        overdue: daysToDue < 0,
      });
      groups.set(key, group);
    }
    return {
      asOf,
      until,
      days,
      count: cheques.length,
      overdue: cheques.filter((c) => String(c.dueDate) < asOf).length,
      totalReceivable: round(
        cheques.filter((c) => c.type === ChequeType.RECEIVED).reduce((s, c) => s + Number(c.amount), 0),
        4,
      ),
      totalPayable: round(
        cheques.filter((c) => c.type === ChequeType.ISSUED).reduce((s, c) => s + Number(c.amount), 0),
        4,
      ),
      treasuries: [...groups.values()],
    };
  }

  /** Received cheque handed to the bank for collection. */
  async deposit(tenantId: string, userId: string, id: string, dto: DepositChequeDto) {
    const cheque = await this.findById(tenantId, id);
    this.expect(cheque, ChequeType.RECEIVED, [ChequeStatus.IN_PORTFOLIO], 'deposited');
    const bank = await this.bankFor(tenantId, cheque, dto.treasuryId, userId);
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
    const bank = await this.bankFor(tenantId, cheque, dto.treasuryId ?? cheque.treasuryId, userId);
    const sourceKey: SettingsAccountKey = fromPortfolio
      ? 'notesReceivableAccountId'
      : 'chequesUnderCollectionAccountId';
    const rates = this.settlementRates(cheque, dto.exchangeRate);
    await this.autoPosting.preflight(tenantId, dto.date, [sourceKey, ...rates.fxKeys]);
    await this.postSettlement(tenantId, userId, cheque, dto.date, 'Collection', (account) =>
      chequeSettlementLines({
        kind: 'collect',
        amount: Number(cheque.amount),
        bookedRate: rates.booked,
        settleRate: rates.settle,
        foreign: !!cheque.currencyId,
        bankAccountId: bank.accountId,
        bankBranchId: bank.branchId ?? undefined,
        notesAccountId: account(sourceKey),
        fxGainAccountId: rates.fxKeys.length ? account('fxGainAccountId') : undefined,
        fxLossAccountId: rates.fxKeys.length ? account('fxLossAccountId') : undefined,
      }),
    );
    cheque.treasuryId = bank.id;
    return this.transition(cheque, ChequeStatus.COLLECTED, dto.date, 'collected', userId, dto.note);
  }

  /** Issued cheque presented and paid from our bank account. */
  async clear(tenantId: string, userId: string, id: string, dto: SettleChequeDto) {
    const cheque = await this.findById(tenantId, id);
    this.expect(cheque, ChequeType.ISSUED, [ChequeStatus.ISSUED], 'cleared');
    const bank = await this.bankFor(tenantId, cheque, dto.treasuryId ?? cheque.treasuryId, userId);
    const rates = this.settlementRates(cheque, dto.exchangeRate);
    await this.treasuries.assertFunds(tenantId, bank, Number(cheque.amount), dto.date);
    await this.autoPosting.preflight(tenantId, dto.date, ['notesPayableAccountId', ...rates.fxKeys]);
    await this.postSettlement(tenantId, userId, cheque, dto.date, 'Clearing', (account) =>
      chequeSettlementLines({
        kind: 'clear',
        amount: Number(cheque.amount),
        bookedRate: rates.booked,
        settleRate: rates.settle,
        foreign: !!cheque.currencyId,
        bankAccountId: bank.accountId,
        bankBranchId: bank.branchId ?? undefined,
        notesAccountId: account('notesPayableAccountId'),
        fxGainAccountId: rates.fxKeys.length ? account('fxGainAccountId') : undefined,
        fxLossAccountId: rates.fxKeys.length ? account('fxLossAccountId') : undefined,
      }),
    );
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
      // Received: the deposit bank charges us; issued: the bank the cheque is drawn on.
      bank = await this.bankFor(tenantId, cheque, dto.treasuryId ?? cheque.treasuryId, userId);
      if (
        dto.chargeToCustomer &&
        (cheque.type !== ChequeType.RECEIVED || cheque.partnerType !== PaymentPartnerType.CUSTOMER)
      ) {
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

  private async bankFor(
    tenantId: string,
    cheque: Cheque,
    treasuryId: string | undefined,
    userId: string,
  ): Promise<Treasury> {
    if (!treasuryId) throw new BadRequestException('A bank treasury is required');
    const bank = await this.treasuries.getUsable(tenantId, userId, treasuryId, TreasuryType.BANK);
    if ((bank.currencyId ?? null) !== (cheque.currencyId ?? null) && bank.currencyId) {
      throw new BadRequestException(`Bank ${bank.code} holds another currency than the cheque`);
    }
    return bank;
  }

  /** Booked and settlement rates; the FX accounts are needed only when they differ. */
  private settlementRates(cheque: Cheque, rate?: number) {
    const booked = Number(cheque.exchangeRate) || 1;
    if (rate !== undefined && !cheque.currencyId && Number(rate) !== 1) {
      throw new BadRequestException('The cheque is in the base currency; the exchange rate must be 1');
    }
    const settle = cheque.currencyId && rate ? Number(rate) : booked;
    const fxKeys: SettingsAccountKey[] =
      round(Number(cheque.amount) * settle, 2) !== round(Number(cheque.amount) * booked, 2)
        ? ['fxGainAccountId', 'fxLossAccountId']
        : [];
    return { booked, settle, fxKeys };
  }

  /** Posts base-currency lines (amounts in currency carried explicitly). */
  private postSettlement(
    tenantId: string,
    userId: string,
    cheque: Cheque,
    date: string,
    label: string,
    build: (account: (key: SettingsAccountKey) => string) => PostingLine[],
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
      exchangeRate: 1,
      buildLines: (_s, account) => build(account),
    });
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
