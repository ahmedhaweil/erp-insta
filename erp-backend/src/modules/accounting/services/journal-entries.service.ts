import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JournalEntry, JournalEntryStatus } from '../entities/journal-entry.entity';
import { JournalLine } from '../entities/journal-line.entity';
import { FiscalYear } from '../entities/fiscal-year.entity';
import { CreateJournalEntryDto } from '../dto/create-journal-entry.dto';
import { JournalPostedEvent } from '../events/journal-posted.event';

@Injectable()
export class JournalEntriesService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly entryRepo: Repository<JournalEntry>,
    @InjectRepository(JournalLine)
    private readonly lineRepo: Repository<JournalLine>,
    @InjectRepository(FiscalYear)
    private readonly fiscalYearRepo: Repository<FiscalYear>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreateJournalEntryDto,
  ): Promise<JournalEntry> {
    // Validate debit = credit
    const totalDebit = dto.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = dto.lines.reduce((sum, l) => sum + Number(l.credit), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.001) {
      throw new UnprocessableEntityException('Total debits must equal total credits');
    }

    // Generate ref number
    const count = await this.entryRepo.count({ where: { tenantId } });
    const refNumber = `JE-${String(count + 1).padStart(6, '0')}`;

    const entry = this.entryRepo.create({
      ...dto,
      tenantId,
      refNumber,
      createdBy: userId,
      status: JournalEntryStatus.DRAFT,
      lines: dto.lines.map((l) => this.lineRepo.create(l)),
    });

    return this.entryRepo.save(entry);
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

  async post(tenantId: string, userId: string, id: string): Promise<JournalEntry> {
    const entry = await this.findById(tenantId, id);

    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new ConflictException('Only draft entries can be posted');
    }

    // Check fiscal year is open
    const fiscalYear = await this.fiscalYearRepo.findOne({
      where: {
        tenantId,
        status: 'open',
      },
    });
    if (!fiscalYear) {
      throw new ConflictException('No open fiscal year found');
    }

    entry.status = JournalEntryStatus.POSTED;
    entry.postedAt = new Date();
    const saved = await this.entryRepo.save(entry);

    // Emit domain event
    const totalAmount = entry.lines.reduce((sum, l) => sum + Number(l.debit), 0);
    this.eventEmitter.emit(
      'journal.posted',
      new JournalPostedEvent(tenantId, userId, entry.id, entry.refNumber, totalAmount),
    );

    return saved;
  }

  async reverse(tenantId: string, userId: string, id: string): Promise<JournalEntry> {
    const original = await this.findById(tenantId, id);

    if (original.status !== JournalEntryStatus.POSTED) {
      throw new ConflictException('Only posted entries can be reversed');
    }

    // Create reversing entry with swapped debits/credits
    const reversedLines = original.lines.map((l) => ({
      accountId: l.accountId,
      costCenterId: l.costCenterId,
      debit: Number(l.credit),
      credit: Number(l.debit),
      description: `Reversal of ${original.refNumber}`,
      branchId: l.branchId,
    }));

    return this.create(tenantId, userId, {
      journalId: original.journalId,
      date: new Date().toISOString().split('T')[0],
      description: `Reversal of ${original.refNumber}`,
      currencyId: original.currencyId,
      exchangeRate: original.exchangeRate,
      lines: reversedLines,
    });
  }
}
