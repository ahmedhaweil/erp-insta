import { OvertimeMode } from './payroll-rules';

export interface ApprovedOvertime {
  date: string;
  hours: number;
}

export interface OvertimeResolution {
  mode: OvertimeMode;
  hours: number;
  /** Hours computed from attendance (tracked employees). */
  attendanceHours: number;
  /** Hours of approved overtime requests. */
  requestedHours: number;
  /** Requested hours not paid because attendance does not support them. */
  rejectedHours: number;
}

const r2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/**
 * Overtime hours paid by payroll.
 *
 * - `auto`: employees tracked by attendance get the overtime computed from
 *   their check-in/out; employees not tracked get their approved overtime
 *   requests.
 * - `approved_only`: only approved overtime requests are paid; for tracked
 *   employees each request is capped at the overtime actually recorded by
 *   attendance on that date.
 */
export function resolveOvertime(input: {
  mode: OvertimeMode;
  tracked: boolean;
  /** date -> overtime hours from attendance. */
  attendanceByDate: Map<string, number>;
  approved: ApprovedOvertime[];
}): OvertimeResolution {
  const attendanceHours = r2([...input.attendanceByDate.values()].reduce((s, h) => s + Number(h || 0), 0));
  const requestedHours = r2(input.approved.reduce((s, r) => s + Number(r.hours || 0), 0));
  if (input.mode !== 'approved_only') {
    return {
      mode: 'auto',
      hours: input.tracked ? attendanceHours : requestedHours,
      attendanceHours,
      requestedHours,
      rejectedHours: 0,
    };
  }
  if (!input.tracked) {
    return { mode: 'approved_only', hours: requestedHours, attendanceHours, requestedHours, rejectedHours: 0 };
  }
  // Several requests on one date share that date's recorded overtime.
  const left = new Map(input.attendanceByDate);
  let hours = 0;
  for (const request of [...input.approved].sort((a, b) => a.date.localeCompare(b.date))) {
    const available = Number(left.get(request.date) ?? 0);
    const take = Math.min(Number(request.hours || 0), Math.max(available, 0));
    hours += take;
    left.set(request.date, available - take);
  }
  hours = r2(hours);
  return {
    mode: 'approved_only',
    hours,
    attendanceHours,
    requestedHours,
    rejectedHours: r2(requestedHours - hours),
  };
}
