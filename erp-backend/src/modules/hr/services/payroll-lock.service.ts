import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PayrollRun, PayrollRunStatus } from '../entities/payroll-run.entity';
import { PayrollLine } from '../entities/payroll-line.entity';

export const POSTED_RUN_STATUSES = [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID];

/** YYYY-MM months touched by a date range. */
export function periodsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Guards HR documents that feed payroll (leaves, overtime, encashments):
 * once an employee's month is in an approved or paid payroll run, changing
 * them would silently desynchronise the posted payroll.
 */
@Injectable()
export class PayrollLockService {
  constructor(
    @InjectRepository(PayrollRun)
    private readonly runRepo: Repository<PayrollRun>,
    @InjectRepository(PayrollLine)
    private readonly lineRepo: Repository<PayrollLine>,
  ) {}

  /** Months (of `periods`) for which the employee is in an approved/paid run. */
  async lockedPeriods(tenantId: string, employeeId: string, periods: string[]): Promise<string[]> {
    if (!periods.length) return [];
    const runs = await this.runRepo.find({
      where: { tenantId, period: In(periods), status: In(POSTED_RUN_STATUSES) },
    });
    if (!runs.length) return [];
    const lines = await this.lineRepo.find({
      where: { runId: In(runs.map((r) => r.id)), employeeId },
    });
    const runIds = new Set(lines.map((l) => l.runId));
    return [...new Set(runs.filter((r) => runIds.has(r.id)).map((r) => r.period))].sort();
  }

  async assertOpen(tenantId: string, employeeId: string, from: string, to: string, what: string) {
    const locked = await this.lockedPeriods(tenantId, employeeId, periodsBetween(from, to));
    if (locked.length) {
      throw new ConflictException(
        `${what} touches ${locked.join(', ')}, already in an approved payroll run; reverse the payroll first`,
      );
    }
  }
}
