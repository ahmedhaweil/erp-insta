import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransferStatus, TreasuryTransfer } from '../entities/treasury-transfer.entity';
import { Treasury, TreasuryType } from '../entities/treasury.entity';
import { CancelDto, CreateTransferDto, DateRangeQueryDto } from '../dto/treasury.dto';
import { AutoPostingService, PostingLine } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round, today } from '@shared/utils/document-totals.util';
import { TreasuriesService } from './treasuries.service';
import { TreasuryLedgerService } from './treasury-ledger.service';

export const TRANSFER_SOURCE = 'treasury_transfer';

/**
 * Transfers between treasuries: cash deposited in a bank, bank withdrawals,
 * bank to bank, with an optional bank fee and different currencies.
 *
 * Posted in base currency with each treasury line keeping its own amount in
 * currency: Dr destination (toAmount) / Cr source (amount + fee), Dr bank
 * charges (fee). Both legs are valued at amount x baseRate, so a transfer
 * itself never creates an exchange difference.
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(TreasuryTransfer)
    private readonly transferRepo: Repository<TreasuryTransfer>,
    private readonly treasuries: TreasuriesService,
    private readonly ledger: TreasuryLedgerService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, query: DateRangeQueryDto & { treasuryId?: string } = {}) {
    const qb = this.transferRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .orderBy('t.date', 'DESC')
      .addOrderBy('t.created_at', 'DESC');
    if (query.treasuryId) {
      qb.andWhere('(t.from_treasury_id = :tr OR t.to_treasury_id = :tr)', {
        tr: query.treasuryId,
      });
    }
    if (query.from) qb.andWhere('t.date >= :from', { from: query.from });
    if (query.to) qb.andWhere('t.date <= :to', { to: query.to });
    return qb.getMany();
  }

  async findById(tenantId: string, id: string): Promise<TreasuryTransfer> {
    const transfer = await this.transferRepo.findOne({ where: { id, tenantId } });
    if (!transfer) throw new NotFoundException('Transfer not found');
    return transfer;
  }

  async create(tenantId: string, userId: string, dto: CreateTransferDto) {
    if (dto.fromTreasuryId === dto.toTreasuryId) {
      throw new BadRequestException('Source and destination treasuries must differ');
    }
    // The user must be custodian of the source; any active destination is allowed.
    const from = await this.treasuries.getUsable(tenantId, userId, dto.fromTreasuryId);
    const to = await this.treasuries.getActive(tenantId, dto.toTreasuryId);
    const values = TransfersService.computeAmounts(from, to, dto);

    const transferNumber = await this.sequenceService.next(tenantId, 'treasury_transfer', 'TRF');
    const transfer = await this.transferRepo.save(
      this.transferRepo.create({
        tenantId,
        transferNumber,
        date: dto.date,
        fromTreasuryId: from.id,
        toTreasuryId: to.id,
        ...values,
        status: TransferStatus.DRAFT,
        reference: dto.reference,
        description: dto.description,
        createdBy: userId,
      }),
    );
    return dto.post ? this.post(tenantId, userId, transfer.id) : transfer;
  }

  /** Validates currencies and derives rate, destination amount and base valuation. */
  static computeAmounts(
    from: Treasury,
    to: Treasury,
    dto: Pick<CreateTransferDto, 'amount' | 'rate' | 'toAmount' | 'baseRate' | 'fee'>,
  ) {
    const amount = round(dto.amount, 4);
    const fee = round(dto.fee ?? 0, 4);
    const sameCurrency = (from.currencyId ?? null) === (to.currencyId ?? null);

    let rate: number;
    let toAmount: number;
    if (sameCurrency) {
      if ((dto.rate && dto.rate !== 1) || (dto.toAmount && round(dto.toAmount, 4) !== amount)) {
        throw new BadRequestException('Treasuries share a currency; the amounts must be equal');
      }
      rate = 1;
      toAmount = amount;
    } else if (dto.toAmount) {
      toAmount = round(dto.toAmount, 4);
      rate = round(toAmount / amount, 8);
    } else if (dto.rate) {
      rate = Number(dto.rate);
      toAmount = round(amount * rate, 4);
    } else {
      throw new BadRequestException(
        'Treasuries hold different currencies: give the exchange rate or the amount received',
      );
    }

    // Base value of one source-currency unit.
    let baseRate: number;
    if (!from.currencyId) baseRate = 1;
    else if (dto.baseRate) baseRate = Number(dto.baseRate);
    else if (!to.currencyId) baseRate = rate; // foreign -> base: the transfer rate is the base rate
    else {
      throw new BadRequestException(
        'The source treasury is in a foreign currency: give baseRate (base units per source unit)',
      );
    }
    if (!from.currencyId && dto.baseRate && dto.baseRate !== 1) {
      throw new BadRequestException('The source treasury is in base currency; baseRate must be 1');
    }
    return { amount, fee, rate, toAmount, baseRate };
  }

  /** Posting lines in base currency, each treasury line keeping its amount in currency. */
  static postingLines(
    transfer: TreasuryTransfer,
    from: Treasury,
    to: Treasury,
    bankChargesAccountId?: string,
  ): PostingLine[] {
    const baseRate = Number(transfer.baseRate) || 1;
    const amount = Number(transfer.amount);
    const fee = Number(transfer.fee || 0);
    const value = round(amount * baseRate, 2);
    const feeValue = round(fee * baseRate, 2);
    const description = `Transfer ${transfer.transferNumber}${
      transfer.description ? ` - ${transfer.description}` : ''
    }`;
    const lines: PostingLine[] = [
      {
        accountId: to.accountId,
        debit: value,
        amountCurrency: to.currencyId ? Number(transfer.toAmount) : undefined,
        branchId: to.branchId ?? undefined,
        description,
      },
    ];
    if (fee > 0) {
      lines.push({ accountId: bankChargesAccountId!, debit: feeValue, description });
    }
    lines.push({
      accountId: from.accountId,
      credit: round(value + feeValue, 2),
      amountCurrency: from.currencyId ? -round(amount + fee, 4) : undefined,
      branchId: from.branchId ?? undefined,
      description,
    });
    return lines;
  }

  async post(tenantId: string, userId: string, id: string): Promise<TreasuryTransfer> {
    const transfer = await this.findById(tenantId, id);
    if (transfer.status !== TransferStatus.DRAFT) {
      throw new ConflictException('Only draft transfers can be posted');
    }
    const from = await this.treasuries.getActive(tenantId, transfer.fromTreasuryId);
    const to = await this.treasuries.getActive(tenantId, transfer.toTreasuryId);
    const fee = Number(transfer.fee || 0);
    await this.treasuries.assertUsable(tenantId, userId, from);
    await this.treasuries.assertFunds(tenantId, from, round(Number(transfer.amount) + fee, 4), transfer.date);
    await this.autoPosting.preflight(tenantId, transfer.date, fee > 0 ? ['bankChargesAccountId'] : []);

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: this.journalType(from, to),
      date: transfer.date,
      description: `Transfer ${transfer.transferNumber}`,
      sourceType: TRANSFER_SOURCE,
      sourceId: transfer.id,
      buildLines: (_s, account) =>
        TransfersService.postingLines(
          transfer,
          from,
          to,
          fee > 0 ? account('bankChargesAccountId') : undefined,
        ),
    });

    transfer.status = TransferStatus.POSTED;
    return this.transferRepo.save(transfer);
  }

  /**
   * Cancels a transfer. A posted transfer gets an explicit mirror entry (the
   * generic reversal would drop the per-line amounts in currency).
   */
  async cancel(tenantId: string, userId: string, id: string, dto: CancelDto = {}) {
    const transfer = await this.findById(tenantId, id);
    if (transfer.status === TransferStatus.CANCELLED) {
      throw new ConflictException('Transfer is already cancelled');
    }
    if (transfer.status === TransferStatus.POSTED) {
      await this.ledger.assertNotReconciled(tenantId, TRANSFER_SOURCE, transfer.id);
      const from = await this.treasuries.findById(tenantId, transfer.fromTreasuryId);
      const to = await this.treasuries.findById(tenantId, transfer.toTreasuryId);
      const fee = Number(transfer.fee || 0);
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: this.journalType(from, to),
        date: dto.date ?? today(),
        description: `Cancellation of transfer ${transfer.transferNumber}`,
        sourceType: TRANSFER_SOURCE,
        sourceId: transfer.id,
        buildLines: (_s, account) =>
          TransfersService.postingLines(
            transfer,
            from,
            to,
            fee > 0 ? account('bankChargesAccountId') : undefined,
          ).map((l) => ({
            ...l,
            debit: l.credit,
            credit: l.debit,
            amountCurrency: l.amountCurrency !== undefined ? -l.amountCurrency : undefined,
          })),
      });
    }
    transfer.status = TransferStatus.CANCELLED;
    return this.transferRepo.save(transfer);
  }

  private journalType(from: Treasury, to: Treasury): JournalType {
    return from.type === TreasuryType.CASH && to.type === TreasuryType.CASH
      ? JournalType.CASH
      : JournalType.BANK;
  }
}
