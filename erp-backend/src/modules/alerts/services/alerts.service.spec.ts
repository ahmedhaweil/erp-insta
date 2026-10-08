import { BadRequestException } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertSourcesService, expectedLockDate, monthEnd, payrollPeriodToCheck } from './alert-sources.service';
import { AlertsSchedulerService } from './alerts-scheduler.service';
import { ALERT_TYPES, AlertType } from '../alert-types';

describe('alert date helpers', () => {
  it('computes month ends', () => {
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(monthEnd('2026-01-31', -1)).toBe('2025-12-31');
  });

  it('checks the current payroll month from the configured day, else the previous month', () => {
    expect(payrollPeriodToCheck('2026-10-08', 25)).toEqual({ period: '2026-09', start: '2026-09-01', end: '2026-09-30' });
    expect(payrollPeriodToCheck('2026-10-26', 25).period).toBe('2026-10');
  });

  it('expects the last month locked once the grace days passed', () => {
    expect(expectedLockDate('2026-10-08', 10)).toBe('2026-08-31');
    expect(expectedLockDate('2026-10-11', 10)).toBe('2026-09-30');
  });
});

describe('AlertSourcesService', () => {
  it('queries due cheques up to the horizon and labels them', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([
        { id: 'c1', cheque_number: '77', type: 'received', status: 'in_portfolio', due_date: '2026-10-10', amount: '500', drawer: 'Ali' },
      ]),
    };
    const sources = new AlertSourcesService(dataSource as any);
    const matches = await sources.find(AlertType.CHEQUES_DUE, {
      tenantId: 't1',
      days: 3,
      hours: 0,
      params: { chequeType: 'received' },
      asOf: '2026-10-08',
      now: new Date(),
    });
    expect(dataSource.query.mock.calls[0][1]).toEqual(['t1', '2026-10-11', 'received']);
    expect(matches).toEqual([
      expect.objectContaining({ recordKey: 'c1', label: 'IN #77 2026-10-10 500.00 Ali' }),
    ]);
  });

  it('raises payroll alerts only with active employees and no run', async () => {
    const dataSource = { query: jest.fn().mockResolvedValueOnce([{ employees: '3', runs: '0' }]).mockResolvedValueOnce([{ employees: '3', runs: '1' }]) };
    const sources = new AlertSourcesService(dataSource as any);
    const q = { tenantId: 't1', days: 25, hours: 0, params: {}, asOf: '2026-10-08', now: new Date() };
    expect(await sources.find(AlertType.PAYROLL_NOT_RUN, q)).toEqual([
      { recordKey: 'payroll:2026-09', label: '2026-09 (3)', data: { period: '2026-09', activeEmployees: 3 } },
    ]);
    expect(await sources.find(AlertType.PAYROLL_NOT_RUN, q)).toEqual([]);
  });

  it('raises the period lock alert when the lock date is behind', async () => {
    const dataSource = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ lock_date: '2026-07-31' }])
        .mockResolvedValueOnce([{ lock_date: '2026-08-31' }])
        .mockResolvedValueOnce([]),
    };
    const sources = new AlertSourcesService(dataSource as any);
    const q = { tenantId: 't1', days: 10, hours: 0, params: {}, asOf: '2026-10-08', now: new Date() };
    expect((await sources.find(AlertType.PERIOD_NOT_LOCKED, q))[0].recordKey).toBe('lock:2026-08');
    expect(await sources.find(AlertType.PERIOD_NOT_LOCKED, q)).toEqual([]);
    // no accounting settings: automatic accounting off, nothing to lock
    expect(await sources.find(AlertType.PERIOD_NOT_LOCKED, q)).toEqual([]);
  });
});

describe('AlertsService', () => {
  let ruleRepo: any;
  let deliveryRepo: any;
  let dataSource: any;
  let sources: any;
  let notifications: any;
  let service: AlertsService;
  const rule = () => ({
    id: 'r1',
    tenantId: 't1',
    type: AlertType.OVERDUE_INVOICES,
    name: 'Overdue',
    isActive: true,
    thresholdDays: null,
    thresholdHours: null,
    params: {},
    recipientUserIds: [],
    recipientRoleIds: ['role-1'],
    severity: null,
  });

  beforeEach(() => {
    ruleRepo = {
      find: jest.fn().mockResolvedValue([rule()]),
      findOne: jest.fn().mockResolvedValue(rule()),
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
      remove: jest.fn(),
    };
    const qb = { update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), execute: jest.fn() };
    deliveryRepo = { createQueryBuilder: jest.fn(() => qb), delete: jest.fn(), find: jest.fn() };
    dataSource = { query: jest.fn() };
    sources = {
      find: jest.fn().mockResolvedValue([
        { recordKey: 'i1', label: 'INV-1', data: {} },
        { recordKey: 'i2', label: 'INV-2', data: {} },
      ]),
    };
    notifications = { create: jest.fn().mockResolvedValue({ id: 'n1' }) };
    service = new AlertsService(ruleRepo, deliveryRepo, dataSource, sources as AlertSourcesService, notifications);
  });

  it('notifies each recipient once per record and day (records already delivered are skipped)', async () => {
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM users u')) return [{ id: 'u1' }, { id: 'u2' }];
      if (sql.includes('INSERT INTO alert_deliveries')) {
        return dataSource.query.mock.calls.filter((c: any[]) => c[0].includes('INSERT')).length === 1
          ? [{ record_key: 'i1' }, { record_key: 'i2' }]
          : []; // u2 already received both today
      }
      return [];
    });
    const [result] = await service.scan('t1', { asOf: '2026-10-08' });
    expect(result).toMatchObject({ matches: 2, newRecords: 2, notifiedUsers: 1 });
    expect(sources.find).toHaveBeenCalledWith(AlertType.OVERDUE_INVOICES, expect.objectContaining({ days: 0, asOf: '2026-10-08' }));
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create.mock.calls[0][1]).toMatchObject({
      userId: 'u1',
      title: 'Overdue',
      body: '(2) INV-1 ; INV-2',
      type: 'warning',
      data: expect.objectContaining({ alertType: AlertType.OVERDUE_INVOICES, count: 2 }),
    });
    const insert = dataSource.query.mock.calls.find((c: any[]) => c[0].includes('INSERT'));
    expect(insert[1]).toEqual(['t1', 'r1', AlertType.OVERDUE_INVOICES, 'u1', '2026-10-08', ['i1', 'i2']]);
  });

  it('dry runs return the matches without notifying', async () => {
    const [result] = await service.scan('t1', { dryRun: true });
    expect(result.items).toHaveLength(2);
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('falls back to tenant administrators when the rule names no recipients', async () => {
    dataSource.query.mockResolvedValue([{ id: 'admin' }]);
    await service.resolveRecipients({ ...rule(), recipientRoleIds: [] } as any);
    expect(dataSource.query.mock.calls[0][0]).toContain('is_system_role = true');
  });

  it('validates recipients and creates one default rule per missing type', async () => {
    dataSource.query.mockResolvedValue([{ n: '0' }]);
    await expect(service.createRule('t1', { type: AlertType.LOW_STOCK, recipientUserIds: ['x'] })).rejects.toThrow(
      BadRequestException,
    );
    const created = await service.createDefaults('t1');
    expect(created).toHaveLength(ALERT_TYPES.length - 1);
    expect(created.every((r) => r.name)).toBe(true);
  });
});

describe('AlertsSchedulerService', () => {
  it('scans tenants one after the other and continues after a failure', async () => {
    const alerts = {
      tenantsToScan: jest.fn().mockResolvedValue(['t1', 't2', 't3']),
      scan: jest.fn(async (t: string) => {
        if (t === 't2') throw new Error('broken');
        return [];
      }),
      logFailure: jest.fn(),
    };
    const scheduler = new AlertsSchedulerService(alerts as any, {} as any);
    jest.spyOn(scheduler as any, 'runForTenant').mockImplementation((_t: any, fn: any) => fn());
    expect(await scheduler.tick()).toBe(2);
    expect(alerts.scan.mock.calls.map((c) => c[0])).toEqual(['t1', 't2', 't3']);
    expect(alerts.logFailure).toHaveBeenCalledWith('t2', expect.any(Error));
  });

  it('stays off without ALERTS_SCAN_INTERVAL_SEC', () => {
    delete process.env.ALERTS_SCAN_INTERVAL_SEC;
    const scheduler = new AlertsSchedulerService({} as any, {} as any);
    scheduler.onModuleInit();
    expect((scheduler as any).timer).toBeNull();
  });
});
