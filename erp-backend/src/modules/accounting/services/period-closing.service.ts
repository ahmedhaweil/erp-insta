import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountingSettings } from '../entities/accounting-settings.entity';
import { PeriodClosing } from '../entities/closing.entity';
import { PeriodLockDto, PeriodReopenDto } from '../dto/accounting-depth.dto';

export interface ClosingCheck {
  code: string;
  count: number;
  message: string;
}

/** Last day of the YYYY-MM month. */
export function periodEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().split('T')[0];
}

/** Items left open in the period; each non-zero count is a warning. */
const CHECKS: { code: string; message: string; sql: string }[] = [
  {
    code: 'draft_journal_entries',
    message: 'Draft journal entries dated in the period',
    sql: `SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND status = 'draft' AND date <= $2`,
  },
  {
    code: 'draft_sales_invoices',
    message: 'Draft customer invoices / credit notes',
    sql: `SELECT COUNT(*)::int AS n FROM sales_invoices WHERE tenant_id = $1 AND status = 'draft' AND date <= $2`,
  },
  {
    code: 'draft_vendor_bills',
    message: 'Draft vendor bills / refunds',
    sql: `SELECT COUNT(*)::int AS n FROM purchase_invoices WHERE tenant_id = $1 AND status = 'draft' AND date <= $2`,
  },
  {
    code: 'draft_treasury_vouchers',
    message: 'Draft receipt / payment vouchers',
    sql: `SELECT COUNT(*)::int AS n FROM treasury_vouchers WHERE tenant_id = $1 AND status = 'draft' AND date <= $2`,
  },
  {
    code: 'unreconciled_bank_statements',
    message: 'Bank statements not fully reconciled',
    sql: `SELECT COUNT(*)::int AS n FROM bank_statements WHERE tenant_id = $1 AND status <> 'reconciled' AND start_date <= $2`,
  },
  {
    code: 'open_pos_sessions',
    message: 'POS sessions still open',
    sql: `SELECT COUNT(*)::int AS n FROM pos_sessions WHERE tenant_id = $1 AND status = 'open' AND opened_at::date <= $2`,
  },
  {
    code: 'recurring_entries_due',
    message: 'Recurring entries due and not generated',
    sql: `SELECT COUNT(*)::int AS n FROM recurring_entries WHERE tenant_id = $1 AND status = 'active' AND next_run_date <= $2`,
  },
  {
    code: 'deferrals_due',
    message: 'Deferred revenue / prepaid expense recognitions not posted',
    sql: `SELECT COUNT(*)::int AS n FROM deferral_schedule_lines l JOIN deferral_schedules s ON s.id = l.schedule_id
           WHERE s.tenant_id = $1 AND s.status = 'active' AND l.status = 'planned' AND l.date <= $2`,
  },
  {
    code: 'pending_approvals',
    message: 'Approval requests still pending',
    sql: `SELECT COUNT(*)::int AS n FROM approval_requests WHERE tenant_id = $1 AND status = 'pending' AND created_at::date <= $2`,
  },
];

/**
 * Monthly period closing: a checklist of open items and the lock date that
 * stops posting in closed periods (Odoo lock date). Checks are warnings, they
 * do not block the lock.
 */
@Injectable()
export class PeriodClosingService {
  constructor(
    @InjectRepository(AccountingSettings)
    private readonly settingsRepo: Repository<AccountingSettings>,
    @InjectRepository(PeriodClosing)
    private readonly closingRepo: Repository<PeriodClosing>,
  ) {}

  async checklist(tenantId: string, date: string) {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    const checks: ClosingCheck[] = [];
    for (const check of CHECKS) {
      // No try/catch: a failed statement would abort the request transaction.
      const [row] = await this.closingRepo.query(check.sql, [tenantId, date]);
      const count = Number(row?.n ?? 0);
      checks.push({ code: check.code, count, message: check.message });
    }
    return {
      date,
      currentLockDate: settings?.lockDate ?? null,
      checks,
      warnings: checks.filter((c) => c.count > 0),
      ready: checks.every((c) => c.count === 0),
    };
  }

  async lock(tenantId: string, userId: string, dto: PeriodLockDto) {
    const lockDate = dto.date ?? (dto.period ? periodEnd(dto.period) : null);
    if (!lockDate) throw new BadRequestException('Give a period (YYYY-MM) or a date');
    const settings = await this.requireSettings(tenantId);
    if (settings.lockDate && lockDate <= settings.lockDate) {
      throw new ConflictException(`The books are already locked up to ${settings.lockDate}`);
    }
    const { warnings } = await this.checklist(tenantId, lockDate);
    const previousLockDate = settings.lockDate ?? null;
    settings.lockDate = lockDate;
    await this.settingsRepo.save(settings);
    const log = await this.closingRepo.save(
      this.closingRepo.create({
        tenantId,
        action: 'lock',
        lockDate,
        previousLockDate,
        warnings,
        notes: dto.notes,
        userId,
      }),
    );
    return { lockDate, previousLockDate, warnings, closingId: log.id };
  }

  /** Moves the lock date back (or removes it) to allow corrections. */
  async reopen(tenantId: string, userId: string, dto: PeriodReopenDto) {
    const settings = await this.requireSettings(tenantId);
    if (!settings.lockDate) throw new ConflictException('No period is locked');
    if (dto.date && dto.date >= settings.lockDate) {
      throw new BadRequestException(`The new lock date must be before ${settings.lockDate}`);
    }
    const previousLockDate = settings.lockDate;
    settings.lockDate = dto.date ?? (null as unknown as string);
    await this.settingsRepo.save(settings);
    await this.closingRepo.save(
      this.closingRepo.create({
        tenantId,
        action: 'reopen',
        lockDate: dto.date ?? null,
        previousLockDate,
        warnings: [],
        notes: dto.notes,
        userId,
      }),
    );
    return { lockDate: dto.date ?? null, previousLockDate };
  }

  history(tenantId: string) {
    return this.closingRepo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  private async requireSettings(tenantId: string): Promise<AccountingSettings> {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    if (!settings) {
      throw new BadRequestException('Configure accounting (PUT /accounting/settings) before locking periods');
    }
    return settings;
  }
}
