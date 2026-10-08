import { resolveOvertime } from './overtime-calculator';

describe('resolveOvertime', () => {
  const attendanceByDate = new Map([
    ['2026-10-01', 2],
    ['2026-10-03', 6],
  ]);
  const approved = [
    { date: '2026-10-01', hours: 3 },
    { date: '2026-10-05', hours: 1.5 },
  ];

  it('auto: attendance overtime for tracked employees', () => {
    expect(resolveOvertime({ mode: 'auto', tracked: true, attendanceByDate, approved }).hours).toBe(8);
  });

  it('auto: approved requests for employees without attendance tracking', () => {
    expect(
      resolveOvertime({ mode: 'auto', tracked: false, attendanceByDate: new Map(), approved }).hours,
    ).toBe(4.5);
  });

  it('approved_only: requests capped at the recorded overtime of the day', () => {
    const result = resolveOvertime({ mode: 'approved_only', tracked: true, attendanceByDate, approved });
    // 1 Oct: 3 requested, 2 recorded -> 2; 5 Oct: nothing recorded -> 0; 3 Oct not requested.
    expect(result).toMatchObject({ hours: 2, requestedHours: 4.5, attendanceHours: 8, rejectedHours: 2.5 });
  });

  it('approved_only: requests paid in full when attendance is not tracked', () => {
    expect(
      resolveOvertime({ mode: 'approved_only', tracked: false, attendanceByDate: new Map(), approved }).hours,
    ).toBe(4.5);
  });

  it('approved_only: several requests share one day', () => {
    const result = resolveOvertime({
      mode: 'approved_only',
      tracked: true,
      attendanceByDate: new Map([['2026-10-03', 6]]),
      approved: [
        { date: '2026-10-03', hours: 4 },
        { date: '2026-10-03', hours: 4 },
      ],
    });
    expect(result.hours).toBe(6);
  });
});
