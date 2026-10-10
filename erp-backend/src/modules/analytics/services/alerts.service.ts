import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '@modules/notifications/entities/notification.entity';
import { NotificationsService } from '@modules/notifications/services/notifications.service';
import { RbacService } from '@modules/auth/services/rbac.service';
import { addDays, today as todayIso } from '@shared/utils/document-totals.util';
import { AnalyticsService } from './analytics.service';
import { AnalyticsSettingsService, AnalyticsSettingsValues } from './analytics-settings.service';
import { Bilingual, Severity, alertDedupKey, dueBucket, r4 } from './analytics-calculator';

export const ALERTS_READ_PERMISSION = { module: 'analytics', screen: 'alerts', action: 'read' };

export interface AlertGroup {
  code: string;
  severity: Severity;
  title: Bilingual;
  count: number;
  total: number | null;
  items: Record<string, unknown>[];
}

const SEVERITY_TO_NOTIFICATION: Record<Severity, NotificationType> = {
  critical: NotificationType.ERROR,
  warning: NotificationType.WARNING,
  info: NotificationType.INFO,
  good: NotificationType.SUCCESS,
};

/**
 * Alert rules (Instasoft setting_alert / QustAlerts): evaluated live from the
 * current data, and turned into notifications (one per alert code, user and
 * day) by `run`.
 */
@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    private readonly settingsService: AnalyticsSettingsService,
    private readonly analytics: AnalyticsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  private query<T = any>(sql: string, params: unknown[]): Promise<T[]> {
    return this.notificationRepo.query(sql, params);
  }

  async evaluate(tenantId: string, today = todayIso()): Promise<{ date: string; alerts: AlertGroup[] }> {
    const s = await this.settingsService.get(tenantId);
    const alerts: AlertGroup[] = [];
    const push = (g: Omit<AlertGroup, 'count'>) => {
      if (g.items.length) alerts.push({ ...g, count: g.items.length });
    };
    const sum = (items: Record<string, unknown>[], key: string) =>
      r4(items.reduce((t, i) => t + (Number(i[key]) || 0), 0));

    if (s.alertCreditLimit) {
      const items = await this.query(
        `SELECT id AS "customerId", code, COALESCE(NULLIF(name_en, ''), name_ar) AS name, balance::float AS balance,
                credit_limit::float AS "creditLimit", (balance - credit_limit)::float AS excess
           FROM customers
          WHERE tenant_id = $1 AND is_active = true AND credit_limit > 0 AND balance > credit_limit
          ORDER BY balance - credit_limit DESC`,
        [tenantId],
      );
      push({
        code: 'customer_over_credit_limit',
        severity: 'critical',
        title: { ar: 'عملاء تجاوزوا حد الائتمان', en: 'Customers over credit limit' },
        total: sum(items, 'excess'),
        items,
      });
    }
    if (s.alertCustomerBalance && s.customerBalanceThreshold > 0) {
      const items = await this.query(
        `SELECT id AS "customerId", code, COALESCE(NULLIF(name_en, ''), name_ar) AS name, balance::float AS balance
           FROM customers WHERE tenant_id = $1 AND is_active = true AND balance > $2 ORDER BY balance DESC`,
        [tenantId, s.customerBalanceThreshold],
      );
      push({
        code: 'customer_balance_high',
        severity: 'warning',
        title: { ar: 'عملاء رصيدهم أعلى من الحد', en: 'Customer balances above threshold' },
        total: sum(items, 'balance'),
        items,
      });
    }
    if (s.alertSupplierBalance && s.supplierBalanceThreshold > 0) {
      const items = await this.query(
        `SELECT id AS "supplierId", code, COALESCE(NULLIF(name_en, ''), name_ar) AS name, balance::float AS balance
           FROM suppliers WHERE tenant_id = $1 AND is_active = true AND balance > $2 ORDER BY balance DESC`,
        [tenantId, s.supplierBalanceThreshold],
      );
      push({
        code: 'supplier_balance_high',
        severity: 'warning',
        title: { ar: 'موردون رصيدهم أعلى من الحد', en: 'Supplier balances above threshold' },
        total: sum(items, 'balance'),
        items,
      });
    }
    if (s.alertMonthExpenses && s.monthExpensesThreshold > 0) {
      const from = `${today.slice(0, 7)}-01`;
      const amount = await this.analytics.expenses(tenantId, from, today);
      if (amount > s.monthExpensesThreshold) {
        push({
          code: 'month_expenses_high',
          severity: 'warning',
          title: { ar: 'مصروفات الشهر تجاوزت الحد', en: 'Month-to-date expenses above threshold' },
          total: amount,
          items: [{ from, to: today, expenses: amount, threshold: s.monthExpensesThreshold }],
        });
      }
    }
    if (s.alertNegativeTreasury) {
      const items = (await this.analytics.treasuryBalances(tenantId)).filter((t) => t.balance < 0);
      push({
        code: 'negative_treasury',
        severity: 'critical',
        title: { ar: 'خزائن أو بنوك برصيد سالب', en: 'Negative cash / bank balances' },
        total: sum(items, 'balance'),
        items,
      });
    }
    if (s.alertNegativeStock) {
      const items = await this.query(
        `SELECT st.product_id AS "productId", p.code, COALESCE(NULLIF(p.name_en, ''), p.name_ar) AS name,
                st.warehouse_id AS "warehouseId", COALESCE(NULLIF(w.name_en, ''), w.name_ar) AS "warehouseName",
                st.quantity::float AS quantity
           FROM stocks st JOIN products p ON p.id = st.product_id
           LEFT JOIN warehouses w ON w.id = st.warehouse_id
          WHERE st.tenant_id = $1 AND st.quantity < 0 ORDER BY st.quantity`,
        [tenantId],
      );
      push({
        code: 'negative_stock',
        severity: 'critical',
        title: { ar: 'أصناف برصيد سالب', en: 'Negative stock' },
        total: null,
        items,
      });
    }
    if (s.alertExpiringLots) {
      const horizon = addDays(today, s.expiryDays);
      const items = (
        await this.query(
          `SELECT l.id AS "lotId", l.lot_number AS "lotNumber", to_char(l.expiry_date, 'YYYY-MM-DD') AS "expiryDate",
                  l.quantity::float AS quantity, l.product_id AS "productId", p.code,
                  COALESCE(NULLIF(p.name_en, ''), p.name_ar) AS name, l.warehouse_id AS "warehouseId",
                  (l.quantity * p.cost_price)::float AS "stockValue"
             FROM stock_lots l JOIN products p ON p.id = l.product_id
            WHERE l.tenant_id = $1 AND l.quantity > 0 AND l.expiry_date IS NOT NULL AND l.expiry_date <= $2
            ORDER BY l.expiry_date`,
          [tenantId, horizon],
        )
      ).map((l) => ({ ...l, expired: l.expiryDate < today }));
      push({
        code: 'lots_expiring',
        severity: items.some((i) => i.expired) ? 'critical' : 'warning',
        title: { ar: `تشغيلات تنتهي صلاحيتها خلال ${s.expiryDays} يوماً`, en: `Lots expiring within ${s.expiryDays} days` },
        total: null,
        items,
      });
    }
    if (s.alertInstallments) {
      const rows = await this.query(
        `SELECT i.id AS "installmentId", p.id AS "planId", p.plan_number AS "planNumber",
                p.customer_id AS "customerId", COALESCE(NULLIF(c.name_en, ''), c.name_ar) AS "customerName",
                i.sequence, to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate",
                (i.amount - i.paid_amount)::float AS outstanding
           FROM installments i
           JOIN installment_plans p ON p.id = i.plan_id
           LEFT JOIN customers c ON c.id = p.customer_id
          WHERE p.tenant_id = $1 AND p.status = 'active' AND i.amount - i.paid_amount > 0.0001
            AND i.due_date <= $2
          ORDER BY i.due_date`,
        [tenantId, addDays(today, s.installmentDays)],
      );
      const buckets = { overdue: [] as any[], due_today: [] as any[], due_soon: [] as any[] };
      for (const r of rows) {
        const b = dueBucket(r.dueDate, today, s.installmentDays);
        if (b) buckets[b].push(r);
      }
      push({
        code: 'installments_overdue',
        severity: 'critical',
        title: { ar: 'أقساط متأخرة', en: 'Overdue installments' },
        total: sum(buckets.overdue, 'outstanding'),
        items: buckets.overdue,
      });
      push({
        code: 'installments_due_today',
        severity: 'warning',
        title: { ar: 'أقساط مستحقة اليوم', en: 'Installments due today' },
        total: sum(buckets.due_today, 'outstanding'),
        items: buckets.due_today,
      });
      push({
        code: 'installments_due_soon',
        severity: 'info',
        title: { ar: `أقساط تستحق خلال ${s.installmentDays} أيام`, en: `Installments due within ${s.installmentDays} days` },
        total: sum(buckets.due_soon, 'outstanding'),
        items: buckets.due_soon,
      });
    }
    if (s.alertCheques) {
      const rows = await this.query(
        `SELECT id AS "chequeId", type, status, cheque_number AS "chequeNumber", bank_name AS "bankName",
                to_char(due_date, 'YYYY-MM-DD') AS "dueDate", (amount * exchange_rate)::float AS amount,
                partner_type AS "partnerType", partner_id AS "partnerId"
           FROM cheques
          WHERE tenant_id = $1 AND due_date <= $2
            AND ((type = 'received' AND status IN ('in_portfolio', 'under_collection'))
              OR (type = 'issued' AND status = 'issued'))
          ORDER BY due_date`,
        [tenantId, addDays(today, s.chequeDays)],
      );
      const items = rows.map((r) => ({ ...r, bucket: dueBucket(r.dueDate, today, s.chequeDays) }));
      const received = items.filter((i) => i.type === 'received');
      const issued = items.filter((i) => i.type === 'issued');
      push({
        code: 'cheques_receivable_due',
        severity: received.some((i) => i.bucket === 'overdue') ? 'critical' : 'warning',
        title: { ar: 'شيكات واردة مستحقة', en: 'Received cheques due' },
        total: sum(received, 'amount'),
        items: received,
      });
      push({
        code: 'cheques_payable_due',
        severity: issued.some((i) => i.bucket === 'overdue') ? 'critical' : 'warning',
        title: { ar: 'شيكات صادرة مستحقة', en: 'Issued cheques due' },
        total: sum(issued, 'amount'),
        items: issued,
      });
    }

    const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2, good: 3 };
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
    return { date: today, alerts };
  }

  /** Users who receive alert notifications. */
  async recipients(tenantId: string, s: AnalyticsSettingsValues): Promise<string[]> {
    const users = await this.query<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 AND is_active = true`,
      [tenantId],
    );
    const ids = users.map((u) => u.id);
    if (s.notifyUserIds?.length) return ids.filter((id) => s.notifyUserIds.includes(id));
    if (!this.rbac) return ids;
    const out: string[] = [];
    for (const id of ids) if (await this.rbac.hasPermission(tenantId, id, ALERTS_READ_PERMISSION)) out.push(id);
    return out;
  }

  /**
   * Evaluates the alerts and creates one notification per alert code and
   * recipient, at most once a day (de-duplicated on `data.dedupKey`).
   */
  async run(tenantId: string, today = todayIso()) {
    const { alerts } = await this.evaluate(tenantId, today);
    const settings = await this.settingsService.get(tenantId);
    const users = await this.recipients(tenantId, settings);
    let created = 0;
    let skipped = 0;
    for (const alert of alerts) {
      const dedupKey = alertDedupKey(alert.code, today);
      const already = await this.query<{ userId: string }>(
        `SELECT user_id AS "userId" FROM notifications WHERE tenant_id = $1 AND data->>'dedupKey' = $2`,
        [tenantId, dedupKey],
      );
      const notified = new Set(already.map((r) => r.userId));
      for (const userId of users) {
        if (notified.has(userId)) {
          skipped++;
          continue;
        }
        await this.notifications.create(tenantId, {
          userId,
          title: `${alert.title.ar} (${alert.count})`,
          body: `${alert.title.en}: ${alert.count}${alert.total !== null ? ` — ${alert.total}` : ''}`,
          type: SEVERITY_TO_NOTIFICATION[alert.severity],
          data: {
            source: 'analytics_alert',
            dedupKey,
            code: alert.code,
            severity: alert.severity,
            count: alert.count,
            total: alert.total,
            items: alert.items.slice(0, 20),
          },
        });
        created++;
      }
    }
    return { date: today, alerts: alerts.length, recipients: users.length, created, skipped };
  }
}
