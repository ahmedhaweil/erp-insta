/**
 * Pure attendance engine: turns daily check-in/out records, approved leaves
 * and the employee's work schedule into the figures payroll needs
 * (absence days, late minutes, overtime hours, paid/unpaid leave days).
 */

export interface ScheduleInput {
  dailyHours: number;
  /** Shift start, HH:mm. */
  startTime: string;
  /** Weekend days, 0 = Sunday ... 6 = Saturday. */
  weekendDays: number[];
  /** Minutes of tolerance before lateness is counted. */
  graceMinutes: number;
}

export interface AttendanceRecordInput {
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
}

export interface AttendanceDayResult {
  date: string;
  type: 'working' | 'weekend' | 'holiday';
  status: 'present' | 'absent' | 'paid_leave' | 'unpaid_leave' | 'off' | 'not_tracked';
  workedHours: number;
  lateMinutes: number;
  overtimeHours: number;
}

export interface AttendanceSummary {
  from: string;
  to: string;
  workingDays: number;
  presentDays: number;
  absenceDays: number;
  paidLeaveDays: number;
  unpaidLeaveDays: number;
  lateMinutes: number;
  workedHours: number;
  overtimeHours: number;
  days: AttendanceDayResult[];
}

export interface AttendanceComputationInput {
  from: string;
  to: string;
  schedule: ScheduleInput;
  records: AttendanceRecordInput[];
  /** date -> paid flag of the approved leave covering that date. */
  leaveDays: Map<string, boolean>;
  holidays: Set<string>;
  /** When false, only leaves are counted (no absence/late/overtime). */
  trackAttendance: boolean;
}

export function toMinutes(time: string | null | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(time).trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Working days between two dates for a schedule (weekends/holidays excluded). */
export function countWorkingDays(
  from: string,
  to: string,
  weekendDays: number[],
  holidays: Set<string> = new Set(),
): number {
  return eachDate(from, to).filter((d) => !weekendDays.includes(weekday(d)) && !holidays.has(d))
    .length;
}

/** Hours between check-in and check-out; an earlier check-out means an overnight shift. */
export function workedHours(checkIn?: string | null, checkOut?: string | null): number {
  const start = toMinutes(checkIn);
  const end = toMinutes(checkOut);
  if (start === null || end === null) return 0;
  const minutes = end >= start ? end - start : end + 1440 - start;
  return Math.round((minutes / 60) * 100) / 100;
}

export function computeAttendance(input: AttendanceComputationInput): AttendanceSummary {
  const byDate = new Map(input.records.map((r) => [r.date, r]));
  const start = toMinutes(input.schedule.startTime) ?? 0;
  const grace = Number(input.schedule.graceMinutes) || 0;
  const dailyHours = Number(input.schedule.dailyHours) || 0;

  const summary: AttendanceSummary = {
    from: input.from,
    to: input.to,
    workingDays: 0,
    presentDays: 0,
    absenceDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    lateMinutes: 0,
    workedHours: 0,
    overtimeHours: 0,
    days: [],
  };

  for (const date of eachDate(input.from, input.to)) {
    const type: AttendanceDayResult['type'] = input.holidays.has(date)
      ? 'holiday'
      : input.schedule.weekendDays.includes(weekday(date))
        ? 'weekend'
        : 'working';
    const record = byDate.get(date);
    const day: AttendanceDayResult = {
      date,
      type,
      status: 'off',
      workedHours: 0,
      lateMinutes: 0,
      overtimeHours: 0,
    };

    if (type === 'working') summary.workingDays += 1;
    const leavePaid = input.leaveDays.get(date);

    if (type === 'working' && leavePaid !== undefined) {
      day.status = leavePaid ? 'paid_leave' : 'unpaid_leave';
      if (leavePaid) summary.paidLeaveDays += 1;
      else summary.unpaidLeaveDays += 1;
    } else if (!input.trackAttendance) {
      day.status = type === 'working' ? 'not_tracked' : 'off';
    } else if (record && toMinutes(record.checkIn) !== null) {
      const hours = workedHours(record.checkIn, record.checkOut);
      day.workedHours = hours;
      if (type === 'working') {
        day.status = 'present';
        summary.presentDays += 1;
        const late = (toMinutes(record.checkIn) as number) - start;
        day.lateMinutes = late > grace ? late : 0;
        day.overtimeHours = Math.max(Math.round((hours - dailyHours) * 100) / 100, 0);
      } else {
        // Work on a weekend or public holiday is entirely overtime.
        day.status = 'present';
        day.overtimeHours = hours;
      }
      summary.lateMinutes += day.lateMinutes;
      summary.overtimeHours += day.overtimeHours;
      summary.workedHours += hours;
    } else if (type === 'working') {
      day.status = 'absent';
      summary.absenceDays += 1;
    }
    summary.days.push(day);
  }

  summary.overtimeHours = Math.round(summary.overtimeHours * 100) / 100;
  summary.workedHours = Math.round(summary.workedHours * 100) / 100;
  return summary;
}
