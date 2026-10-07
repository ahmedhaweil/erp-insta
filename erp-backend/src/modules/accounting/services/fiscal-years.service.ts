import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { JournalEntry, JournalEntryStatus } from '../entities/journal-entry.entity';
import { JournalLine } from '../entities/journal-line.entity';
import { Account, AccountType } from '../entities/account.entity';
import { JournalType } from '../entities/journal.entity';
import { CreateFiscalYearDto } from '../dto/fixed-asset.dto';
import { AutoPostingService } from './auto-posting.service';
import { round } from '@shared/utils/document-totals.util';

@Injectable()
export class FiscalYearsService {
  constructor(
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepo: Repository<FiscalYear>,
    @InjectRepository(JournalEntry)
    private readonly entryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalLine)
    private readonly lineRepo: Repository<JournalLine>,
    private readonly autoPosting: AutoPostingService,
  ) {}

  findAll(tenantId: string): Promise<FiscalYear[]> {
    return this.fiscalYearRepo.find({ where: { tenantId }, order: { startDate: 'DESC' } });
  }

  async create(tenantId: string, dto: CreateFiscalYearDto): Promise<FiscalYear> {
    if (dto.startDate >= dto.endDate) {
      throw new BadRequestException('Fiscal year start date must be before its end date');
    }
    const overlapping = await this.fiscalYearRepo.findOne({
      where: {
        tenantId,
        startDate: LessThanOrEqual(dto.endDate),
        endDate: MoreThanOrEqual(dto.startDate),
      },
    });
    if (overlapping) {
      throw new ConflictException(`Fiscal year overlaps with ${overlapping.name}`);
    }
    return this.fiscalYearRepo.save(
      this.fiscalYearRepo.create({ ...dto, tenantId, status: 'open' }),
    );
  }

  /**
   * Year-end closing: transfers income and expense balances to retained
   * earnings with a closing entry dated on the last day, then closes the year
   * so no further entries can be posted in it.
   */
  async close(tenantId: string, userId: string, id: string) {
    const year = await this.fiscalYearRepo.findOne({ where: { id, tenantId } });
    if (!year) throw new NotFoundException('Fiscal year not found');
    if (year.status === 'closed') throw new ConflictException('Fiscal year is already closed');

    const drafts = await this.entryRepo.count({
      where: {
        tenantId,
        status: JournalEntryStatus.DRAFT,
        date: Between(year.startDate, year.endDate),
      },
    });
    if (drafts > 0) {
      throw new ConflictException(
        `${drafts} draft journal entries are dated in this fiscal year; post or cancel them first`,
      );
    }

    const balances: { accountId: string; balance: string }[] = await this.lineRepo
      .createQueryBuilder('line')
      .innerJoin('line.entry', 'entry')
      .innerJoin(Account, 'account', 'account.id = line.accountId')
      .select('line.accountId', 'accountId')
      .addSelect('SUM(line.debit) - SUM(line.credit)', 'balance')
      .where('entry.tenantId = :tenantId', { tenantId })
      .andWhere('entry.status = :status', { status: JournalEntryStatus.POSTED })
      .andWhere('entry.date BETWEEN :start AND :end', { start: year.startDate, end: year.endDate })
      .andWhere('account.type IN (:...types)', {
        types: [AccountType.REVENUE, AccountType.EXPENSE],
      })
      .groupBy('line.accountId')
      .getRawMany();

    const nonZero = balances
      .map((b) => ({ accountId: b.accountId, balance: round(Number(b.balance), 4) }))
      .filter((b) => b.balance !== 0);
    const netIncome = round(-nonZero.reduce((sum, b) => sum + b.balance, 0), 4);

    const closingEntry = await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date: year.endDate,
      description: `Closing entry ${year.name}`,
      sourceType: 'fiscal_year_closing',
      sourceId: year.id,
      buildLines: (settings, account) => {
        if (nonZero.length === 0) return [];
        return [
          ...nonZero.map((b) =>
            b.balance > 0
              ? { accountId: b.accountId, credit: b.balance }
              : { accountId: b.accountId, debit: -b.balance },
          ),
          netIncome >= 0
            ? { accountId: account('retainedEarningsAccountId'), credit: netIncome }
            : { accountId: account('retainedEarningsAccountId'), debit: -netIncome },
        ];
      },
    });

    if (nonZero.length > 0 && !closingEntry) {
      throw new BadRequestException(
        'Configure accounting settings (retained earnings account) before closing a year with results',
      );
    }

    year.status = 'closed';
    await this.fiscalYearRepo.save(year);
    return { fiscalYear: year, netIncome, closingEntryId: closingEntry?.id ?? null };
  }
}
