import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import {
  DeferralLineStatus,
  DeferralSchedule,
  DeferralScheduleLine,
  DeferralStatus,
  DeferralType,
} from '../entities/deferral-schedule.entity';
import { Account } from '../entities/account.entity';
import { JournalType } from '../entities/journal.entity';
import { CancelDeferralDto, CreateDeferralDto } from '../dto/accounting-depth.dto';
import { JournalEntriesService } from './journal-entries.service';
import { AutoPostingService } from './auto-posting.service';
import { SequenceService } from '@shared/services/sequence.service';
import { round, today } from '@shared/utils/document-totals.util';

export const DEFERRAL_SOURCE = 'deferral';

function monthEnd(isoDate: string, offset: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0))
    .toISOString()
    .split('T')[0];
}

/**
 * Equal monthly recognition at each month end starting with the start
 * month; the last month absorbs rounding so the lines sum to the amount.
 */
export function computeDeferralLines(
  amount: number,
  startDate: string,
  months: number,
): { sequence: number; date: string; amount: number }[] {
  const total = round(amount, 2);
  const monthly = round(total / months, 2);
  const lines = [];
  let allocated = 0;
  for (let i = 0; i < months; i++) {
    const value = i === months - 1 ? round(total - allocated, 2) : monthly;
    allocated = round(allocated + value, 2);
    lines.push({ sequence: i + 1, date: monthEnd(startDate, i), amount: value });
  }
  return lines;
}

/** Recognition entry lines for one period of a schedule. */
export function recognitionLines(schedule: DeferralSchedule, amount: number) {
  const common = {
    costCenterId: schedule.costCenterId ?? undefined,
    branchId: schedule.branchId ?? undefined,
    description: schedule.name,
  };
  return schedule.type === DeferralType.REVENUE
    ? [
        { ...common, accountId: schedule.deferralAccountId, debit: amount, credit: 0 },
        { ...common, accountId: schedule.plAccountId, debit: 0, credit: amount },
      ]
    : [
        { ...common, accountId: schedule.plAccountId, debit: amount, credit: 0 },
        { ...common, accountId: schedule.deferralAccountId, debit: 0, credit: amount },
      ];
}

/** Deferred revenue and prepaid expenses with monthly recognition. */
@Injectable()
export class DeferralsService {
  constructor(
    @InjectRepository(DeferralSchedule)
    private readonly scheduleRepo: Repository<DeferralSchedule>,
    @InjectRepository(DeferralScheduleLine)
    private readonly lineRepo: Repository<DeferralScheduleLine>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly journalEntries: JournalEntriesService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, type?: DeferralType): Promise<DeferralSchedule[]> {
    const where: any = { tenantId };
    if (type) where.type = type;
    return this.scheduleRepo.find({ where, order: { startDate: 'DESC', createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string): Promise<DeferralSchedule> {
    const schedule = await this.scheduleRepo.findOne({
      where: { id, tenantId },
      relations: ['lines'],
    });
    if (!schedule) throw new NotFoundException('Deferral schedule not found');
    schedule.lines.sort((a, b) => a.sequence - b.sequence);
    return schedule;
  }

  async create(tenantId: string, userId: string, dto: CreateDeferralDto): Promise<DeferralSchedule> {
    if (dto.deferralAccountId === dto.plAccountId) {
      throw new BadRequestException('Deferral and P&L accounts must differ');
    }
    const ids = [dto.deferralAccountId, dto.plAccountId, dto.counterpartAccountId].filter(
      Boolean,
    ) as string[];
    const found = await this.accountRepo.count({ where: { tenantId, id: In(ids) } });
    if (found !== new Set(ids).size) throw new NotFoundException('One or more accounts do not exist');

    const scheduleNumber = await this.sequenceService.next(
      tenantId,
      dto.type === DeferralType.REVENUE ? 'deferred_revenue' : 'prepaid_expense',
      dto.type === DeferralType.REVENUE ? 'DREV' : 'DEXP',
    );
    const schedule = await this.scheduleRepo.save(
      this.scheduleRepo.create({
        tenantId,
        scheduleNumber,
        type: dto.type,
        name: dto.name,
        reference: dto.reference,
        amount: round(dto.amount, 2),
        deferralAccountId: dto.deferralAccountId,
        plAccountId: dto.plAccountId,
        counterpartAccountId: dto.counterpartAccountId ?? null,
        startDate: dto.startDate,
        months: dto.months,
        costCenterId: dto.costCenterId ?? null,
        branchId: dto.branchId ?? null,
        status: DeferralStatus.ACTIVE,
        createdBy: userId,
        lines: computeDeferralLines(dto.amount, dto.startDate, dto.months).map((l) =>
          this.lineRepo.create({ ...l, status: DeferralLineStatus.PLANNED }),
        ),
      }),
    );

    if (dto.counterpartAccountId) {
      // Initial booking: revenue billed/collected in advance, or expense paid in advance.
      const amount = round(dto.amount, 2);
      const revenue = dto.type === DeferralType.REVENUE;
      const entry = await this.postEntry(schedule, dto.startDate, `${schedule.scheduleNumber} initial`, [
        {
          accountId: revenue ? dto.counterpartAccountId : dto.deferralAccountId,
          debit: amount,
          credit: 0,
        },
        {
          accountId: revenue ? dto.deferralAccountId : dto.counterpartAccountId,
          debit: 0,
          credit: amount,
        },
      ]);
      schedule.initialEntryId = entry.id;
      await this.scheduleRepo.save(schedule);
    }
    return this.findById(tenantId, schedule.id);
  }

  /**
   * Posts every planned line dated on or before `asOf`. Idempotent: posted
   * lines carry their entry id and are never posted again.
   */
  async runDue(tenantId: string, asOf: string = today(), scheduleId?: string) {
    const where: any = { tenantId, status: DeferralStatus.ACTIVE };
    if (scheduleId) where.id = scheduleId;
    const schedules = await this.scheduleRepo.find({ where });
    const results: { scheduleId: string; scheduleNumber: string; posted: number; amount: number; error?: string }[] = [];

    for (const schedule of schedules) {
      const due = await this.lineRepo.find({
        where: {
          scheduleId: schedule.id,
          status: DeferralLineStatus.PLANNED,
          date: LessThanOrEqual(asOf),
        },
        order: { sequence: 'ASC' },
      });
      if (!due.length) continue;
      const result = { scheduleId: schedule.id, scheduleNumber: schedule.scheduleNumber, posted: 0, amount: 0 } as (typeof results)[number];
      for (const line of due) {
        try {
          const entry = await this.postEntry(
            schedule,
            line.date,
            `${schedule.scheduleNumber} ${line.sequence}/${schedule.months}`,
            recognitionLines(schedule, Number(line.amount)),
          );
          line.status = DeferralLineStatus.POSTED;
          line.entryId = entry.id;
          await this.lineRepo.save(line);
          schedule.recognizedAmount = round(Number(schedule.recognizedAmount) + Number(line.amount), 4);
          result.posted += 1;
          result.amount = round(result.amount + Number(line.amount), 2);
        } catch (err) {
          if (!(err instanceof HttpException)) throw err;
          result.error = `${line.date}: ${err.message}`;
          break;
        }
      }
      await this.completeIfDone(schedule);
      results.push(result);
    }
    return { asOf, schedules: results };
  }

  /**
   * Stops the schedule. Planned lines are cancelled; with recognizeRemaining
   * the remaining amount is recognised in one entry on `date`.
   */
  async cancel(tenantId: string, userId: string, id: string, dto: CancelDeferralDto = {}) {
    const schedule = await this.findById(tenantId, id);
    if (schedule.status !== DeferralStatus.ACTIVE) {
      throw new ConflictException(`Schedule is already ${schedule.status}`);
    }
    const planned = schedule.lines.filter((l) => l.status === DeferralLineStatus.PLANNED);
    const remaining = round(planned.reduce((s, l) => s + Number(l.amount), 0), 2);
    if (dto.recognizeRemaining && remaining > 0) {
      const date = dto.date || today();
      const entry = await this.postEntry(
        schedule,
        date,
        `${schedule.scheduleNumber} remaining`,
        recognitionLines(schedule, remaining),
        userId,
      );
      schedule.recognizedAmount = round(Number(schedule.recognizedAmount) + remaining, 4);
      for (const line of planned) {
        line.status = DeferralLineStatus.POSTED;
        line.entryId = entry.id;
      }
      schedule.status = DeferralStatus.COMPLETED;
    } else {
      planned.forEach((l) => (l.status = DeferralLineStatus.CANCELLED));
      schedule.status = DeferralStatus.CANCELLED;
    }
    await this.lineRepo.save(planned);
    const { lines: _l, ...header } = schedule;
    await this.scheduleRepo.save(header as DeferralSchedule);
    return this.findById(tenantId, id);
  }

  async tenantsDue(asOf: string): Promise<string[]> {
    const rows: { tenant_id: string }[] = await this.scheduleRepo.query(
      `SELECT DISTINCT s.tenant_id FROM deferral_schedules s
         JOIN deferral_schedule_lines l ON l.schedule_id = s.id
        WHERE s.status = 'active' AND l.status = 'planned' AND l.date <= $1`,
      [asOf],
    );
    return rows.map((r) => r.tenant_id);
  }

  private async completeIfDone(schedule: DeferralSchedule): Promise<void> {
    const planned = await this.lineRepo.count({
      where: { scheduleId: schedule.id, status: DeferralLineStatus.PLANNED },
    });
    if (planned === 0) schedule.status = DeferralStatus.COMPLETED;
    const { lines: _l, ...header } = schedule;
    await this.scheduleRepo.save(header as DeferralSchedule);
  }

  private async postEntry(
    schedule: DeferralSchedule,
    date: string,
    description: string,
    lines: { accountId: string; debit: number; credit: number; description?: string; costCenterId?: string; branchId?: string }[],
    userId?: string,
  ) {
    const journal = await this.autoPosting.resolveJournal(schedule.tenantId, JournalType.GENERAL);
    return this.journalEntries.createAndPost(
      schedule.tenantId,
      userId ?? schedule.createdBy,
      { journalId: journal.id, date, description: `${description} - ${schedule.name}`, lines },
      { sourceType: DEFERRAL_SOURCE, sourceId: schedule.id },
    );
  }
}
