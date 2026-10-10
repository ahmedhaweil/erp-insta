import { NotificationType } from '@modules/notifications/entities/notification.entity';
import { AlertsService } from './alerts.service';
import { DEFAULT_ANALYTICS_SETTINGS } from './analytics-settings.service';

describe('AlertsService', () => {
  const tenantId = 't1';
  const today = '2026-10-09';
  let queries: [RegExp, unknown[]][];
  let repo: { query: jest.Mock };
  let settings: { get: jest.Mock };
  let analytics: { expenses: jest.Mock; treasuryBalances: jest.Mock };
  let notifications: { create: jest.Mock };
  let rbac: { hasPermission: jest.Mock };
  let service: AlertsService;

  beforeEach(() => {
    queries = [];
    repo = {
      query: jest.fn(async (sql: string) => {
        const hit = queries.find(([re]) => re.test(sql));
        return hit ? hit[1] : [];
      }),
    };
    settings = { get: jest.fn().mockResolvedValue({ ...DEFAULT_ANALYTICS_SETTINGS }) };
    analytics = { expenses: jest.fn().mockResolvedValue(0), treasuryBalances: jest.fn().mockResolvedValue([]) };
    notifications = { create: jest.fn().mockResolvedValue({}) };
    rbac = { hasPermission: jest.fn().mockResolvedValue(true) };
    service = new AlertsService(
      repo as any,
      settings as any,
      analytics as any,
      notifications as any,
      rbac as any,
    );
  });

  it('returns nothing when no rule matches', async () => {
    expect((await service.evaluate(tenantId, today)).alerts).toEqual([]);
  });

  it('buckets installments into overdue / due today / due soon', async () => {
    queries.push([
      /FROM installments/,
      [
        { installmentId: 'i1', dueDate: '2026-10-01', outstanding: 100 },
        { installmentId: 'i2', dueDate: '2026-10-09', outstanding: 50 },
        { installmentId: 'i3', dueDate: '2026-10-15', outstanding: 25 },
      ],
    ]);
    const { alerts } = await service.evaluate(tenantId, today);
    const by = Object.fromEntries(alerts.map((a) => [a.code, a]));
    expect(by.installments_overdue.items.map((i) => i.installmentId)).toEqual(['i1']);
    expect(by.installments_overdue.severity).toBe('critical');
    expect(by.installments_due_today.total).toBe(50);
    expect(by.installments_due_soon.count).toBe(1);
    // the query horizon is today + installmentDays
    const call = repo.query.mock.calls.find(([sql]) => /FROM installments/.test(sql));
    expect(call[1]).toEqual([tenantId, '2026-10-16']);
  });

  it('only evaluates enabled rules, with thresholds', async () => {
    settings.get.mockResolvedValue({
      ...DEFAULT_ANALYTICS_SETTINGS,
      alertCreditLimit: false,
      alertMonthExpenses: true,
      monthExpensesThreshold: 1000,
      alertCustomerBalance: true,
      customerBalanceThreshold: 0, // threshold 0 = rule off
    });
    analytics.expenses.mockResolvedValue(1500);
    queries.push([/credit_limit > 0/, [{ customerId: 'c1', excess: 10 }]]);
    const { alerts } = await service.evaluate(tenantId, today);
    expect(alerts.map((a) => a.code)).toEqual(['month_expenses_high']);
    expect(analytics.expenses).toHaveBeenCalledWith(tenantId, '2026-10-01', today);
  });

  it('flags negative treasuries, credit limit and expired lots, critical first', async () => {
    analytics.treasuryBalances.mockResolvedValue([
      { treasuryId: 'x', balance: -5 },
      { treasuryId: 'y', balance: 10 },
    ]);
    queries.push([/credit_limit > 0/, [{ customerId: 'c1', excess: 10 }]]);
    queries.push([/FROM stock_lots/, [{ lotId: 'l1', expiryDate: '2026-10-20' }]]);
    const { alerts } = await service.evaluate(tenantId, today);
    expect(alerts.map((a) => `${a.code}:${a.severity}`)).toEqual([
      'customer_over_credit_limit:critical',
      'negative_treasury:critical',
      'lots_expiring:warning',
    ]);
    expect(alerts[1].items).toEqual([{ treasuryId: 'x', balance: -5 }]);
  });

  it('splits received and issued cheques', async () => {
    queries.push([
      /FROM cheques/,
      [
        { chequeId: 'a', type: 'received', dueDate: '2026-10-08', amount: 100 },
        { chequeId: 'b', type: 'issued', dueDate: '2026-10-10', amount: 40 },
      ],
    ]);
    const { alerts } = await service.evaluate(tenantId, today);
    const by = Object.fromEntries(alerts.map((a) => [a.code, a]));
    expect(by.cheques_receivable_due.severity).toBe('critical');
    expect(by.cheques_payable_due.severity).toBe('warning');
    expect(by.cheques_payable_due.items[0].bucket).toBe('due_soon');
  });

  describe('run', () => {
    beforeEach(() => {
      queries.push([/FROM stocks st/, [{ productId: 'p1', quantity: -2 }]]);
      queries.push([/FROM users/, [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }]]);
    });

    it('notifies users holding analytics/alerts/read once per alert and day', async () => {
      rbac.hasPermission.mockImplementation(async (_t: string, id: string) => id !== 'u3');
      queries.push([/FROM notifications/, [{ userId: 'u2' }]]);
      const res = await service.run(tenantId, today);
      expect(res).toMatchObject({ alerts: 1, recipients: 2, created: 1, skipped: 1 });
      expect(notifications.create).toHaveBeenCalledWith(
        tenantId,
        expect.objectContaining({
          userId: 'u1',
          type: NotificationType.ERROR,
          data: expect.objectContaining({ dedupKey: 'analytics:negative_stock:2026-10-09', count: 1 }),
        }),
      );
    });

    it('uses the configured recipients when set', async () => {
      settings.get.mockResolvedValue({ ...DEFAULT_ANALYTICS_SETTINGS, notifyUserIds: ['u3'] });
      const res = await service.run(tenantId, today);
      expect(res.recipients).toBe(1);
      expect(rbac.hasPermission).not.toHaveBeenCalled();
      expect(notifications.create.mock.calls[0][1].userId).toBe('u3');
    });
  });
});
