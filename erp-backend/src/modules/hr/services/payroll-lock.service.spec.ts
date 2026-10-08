import { ConflictException } from '@nestjs/common';
import { PayrollLockService, periodsBetween } from './payroll-lock.service';
import { PayrollRunStatus } from '../entities/payroll-run.entity';

describe('PayrollLockService', () => {
  it('lists the months of a date range', () => {
    expect(periodsBetween('2026-11-20', '2027-02-03')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(periodsBetween('2026-10-01', '2026-10-31')).toEqual(['2026-10']);
  });

  it('locks months where the employee is in an approved or paid run', async () => {
    const runRepo = {
      find: jest.fn(async () => [
        { id: 'r1', period: '2026-10', status: PayrollRunStatus.APPROVED },
        { id: 'r2', period: '2026-11', status: PayrollRunStatus.PAID },
      ]),
    };
    const lineRepo = { find: jest.fn(async () => [{ runId: 'r1', employeeId: 'e1' }]) };
    const service = new PayrollLockService(runRepo as any, lineRepo as any);
    expect(await service.lockedPeriods('t1', 'e1', ['2026-10', '2026-11'])).toEqual(['2026-10']);
    await expect(service.assertOpen('t1', 'e1', '2026-10-30', '2026-11-02', 'Leave LV-1')).rejects.toThrow(
      ConflictException,
    );
    lineRepo.find.mockResolvedValueOnce([]);
    await expect(service.assertOpen('t1', 'e1', '2026-10-30', '2026-11-02', 'Leave')).resolves.toBeUndefined();
  });
});
