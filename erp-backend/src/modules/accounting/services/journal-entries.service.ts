import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JournalEntry, JournalEntryStatus } from '../entities/journal-entry.entity';
import { JournalLine } from '../entities/journal-line.entity';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { Account } from '../entities/account.entity';
import { AccountingSettings } from '../entities/accounting-settings.entity';
import { CreateJournalEntryDto } from '../dto/create-journal-entry.dto';
import { JournalPostedEvent } from '../events/journal-posted.event';
import { SequenceService } from '@shared/services/sequence.service';
import { today } from '@shared/utils/document-totals.util';

export interface JournalEntrySource {
  sourceType?: string;
  sourceId?: string;
  reversedEntryId?: string;
}

@Injectable()
export class JournalEntriesService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly entryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalLine)
    private readonly lineRepo: Repository<JournalLine>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepo: Repository<FiscalYear>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(AccountingSettings)
    private readonly settingsRepo: Repository<AccountingSettings>,
    private readonly sequenceService: SequenceService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreateJournalEntryDto,
    source: JournalEntrySource = {},
  ): Promise<JournalEntry> {
    for (const line of dto.lines) {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      if (debit < 0 || credit < 0) {
        throw new UnprocessableEntityException('Debit and credit amounts cannot be negative');
      }
      if (debit > 0 && credit > 0) {
        throw new UnprocessableEntityException('A journal line cannot have both a debit and a credit');
      }
      if (debit === 0 && credit === 0) {
        throw new UnprocessableEntityException('A journal line must have a debit or a credit');
      }
    }

    const totalDebit = dto.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = dto.lines.reduce((sum, l) => sum + Number(l.credit), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new UnprocessableEntityException('Total debits must equal total credits');
    }

    const refNumber = await this.sequenceService.next(tenantId, 'journal_entry', 'JE');

    const entry = this.entryRepo.create({
      ...dto,
      ...source,
      tenantId,
      refNumber,
      createdBy: userId,
      status: JournalEntryStatus.DRAFT,
      lines: dto.lines.map((l) => this.lineRepo.create(l)),
    });

    return this.entryRepo.save(entry);
  }

  /** Creates and immediately posts an entry (used by automatic document postings). */
  async createAndPost(
    tenantId: string,
    userId: string,
    dto: CreateJournalEntryDto,
    source: JournalEntrySource = {},
  ): Promise<JournalEntry> {
    // Validate before writing so a refused posting never leaves a draft behind
    await this.assertPeriodOpen(tenantId, dto.date);
    await this.assertAccountsPostable(tenantId, dto.lines.map((l) => l.accountId));

    const entry = await this.create(tenantId, userId, dto, source);
    try {
      return await this.post(tenantId, userId, entry.id, entry);
    } catch (err) {
      entry.status = JournalEntryStatus.CANCELLED;
      await this.entryRepo.save(entry);
      throw err;
    }
  }

  async findAll(tenantId: string): Promise<JournalEntry[]> {
    return this.entryRepo.find({
      where: { tenantId },
      relations: ['lines'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<JournalEntry> {
    const entry = await this.entryRepo.findOne({
      where: { id, tenantId },
      relations: ['lines'],
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  async findBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
  ): Promise<JournalEntry[]> {
    return this.entryRepo.find({
      where: { tenantId, sourceType, sourceId, status: JournalEntryStatus.POSTED },
      relations: ['lines'],
    });
  }

  async post(
    tenantId: string,
    userId: string,
    id: string,
    preloaded?: JournalEntry,
  ): Promise<JournalEntry> {
    const entry = preloaded ?? (await this.findById(tenantId, id));

    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new ConflictException('Only draft entries can be posted');
    }

    await this.assertPeriodOpen(tenantId, entry.date);
    await this.assertAccountsPostable(tenantId, entry.lines.map((l) => l.accountId));

    entry.status = JournalEntryStatus.POSTED;
    entry.postedAt = new Date();
    const saved = await this.entryRepo.save(entry);

    const totalAmount = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    this.eventEmitter.emit(
      'journal.posted',
      new JournalPostedEvent(tenantId, userId, entry.id, entry.refNumber, totalAmount),
    );

    return saved;
  }

  /** Deletes nothing: posted entries are immutable. Draft entries can be cancelled. */
  async cancel(tenantId: string, id: string): Promise<JournalEntry> {
    const entry = await this.findById(tenantId, id);
    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new ConflictException('Only draft entries can be cancelled; reverse posted entries instead');
    }
    entry.status = JournalEntryStatus.CANCELLED;
    return this.entryRepo.save(entry);
  }

  /**
   * Creates and posts a reversing entry (Odoo "Reverse Entry"). Posted entries
   * are never edited, so corrections always go through a reversal.
   */
  async reverse(
    tenantId: string,
    userId: string,
    id: string,
    date: string = today(),
  ): Promise<JournalEntry> {
    const original = await this.findById(tenantId, id);

    if (original.status !== JournalEntryStatus.POSTED) {
      throw new ConflictException('Only posted entries can be reversed');
    }

    const alreadyReversed = await this.entryRepo.findOne({
      where: { tenantId, reversedEntryId: original.id, status: JournalEntryStatus.POSTED },
    });
    if (alreadyReversed) {
      throw new ConflictException(`Entry already reversed by ${alreadyReversed.refNumber}`);
    }

    const reversedLines = original.lines.map((l) => ({
      accountId: l.accountId,
      costCenterId: l.costCenterId,
      debit: Number(l.credit),
      credit: Number(l.debit),
      amountCurrency: l.amountCurrency != null ? -Number(l.amountCurrency) : undefined,
      description: `Reversal of ${original.refNumber}`,
      branchId: l.branchId,
    }));

    return this.createAndPost(
      tenantId,
      userId,
      {
        journalId: original.journalId,
        date,
        description: `Reversal of ${original.refNumber}`,
        currencyId: original.currencyId,
        exchangeRate: original.exchangeRate,
        lines: reversedLines,
      },
      {
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        reversedEntryId: original.id,
      },
    );
  }

  /** The entry date must fall inside an open fiscal year and after the lock date. */
  async assertPeriodOpen(tenantId: string, date: string): Promise<void> {
    const fiscalYear = await this.fiscalYearRepo.findOne({
      where: {
        tenantId,
        status: 'open',
        startDate: LessThanOrEqual(date),
        endDate: MoreThanOrEqual(date),
      },
    });
    if (!fiscalYear) {
      throw new ConflictException(`No open fiscal year covers ${date}`);
    }

    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    if (settings?.lockDate && date <= settings.lockDate) {
      throw new ConflictException(
        `The period is locked up to ${settings.lockDate}; entries dated ${date} cannot be posted`,
      );
    }
  }

  private async assertAccountsPostable(tenantId: string, accountIds: string[]): Promise<void> {
    const ids = [...new Set(accountIds)];
    const accounts = await this.accountRepo.find({ where: { tenantId, id: In(ids) } });
    if (accounts.length !== ids.length) {
      throw new UnprocessableEntityException('One or more accounts do not exist');
    }
    const invalid = accounts.find((a) => !a.isActive || !a.allowPosting);
    if (invalid) {
      throw new UnprocessableEntityException(
        `Account ${invalid.code} is inactive or is a view account that does not allow posting`,
      );
    }
  }
}
