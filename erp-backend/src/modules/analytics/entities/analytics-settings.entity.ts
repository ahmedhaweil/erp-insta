import { Column, Entity, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

const decimal = (name: string, def: number) => ({
  name,
  type: 'decimal' as const,
  precision: 18,
  scale: 4,
  default: def,
  transformer: { to: (v: unknown) => v, from: (v: unknown) => (v === null || v === undefined ? v : Number(v)) },
});

/**
 * Per-tenant analytics options (one row per tenant): insight thresholds,
 * default list parameters and the alert rules (Instasoft setting_alert
 * p1..p14, which were stored but never evaluated there).
 */
@Entity('analytics_settings')
@Index(['tenantId'], { unique: true })
export class AnalyticsSettings extends TenantBaseEntity {
  // ── list defaults ──
  /** Days without a sale before an item in stock counts as slow-moving. */
  @Column({ name: 'stagnation_days', type: 'int', default: 30 })
  stagnationDays: number;

  /** Low stock when on hand covers this many days or fewer. */
  @Column({ name: 'low_cover_days', type: 'int', default: 14 })
  lowCoverDays: number;

  /** Overstock when on hand covers this many days or more. */
  @Column({ name: 'overstock_days', type: 'int', default: 90 })
  overstockDays: number;

  /** Days of consumption purchase suggestions should cover. */
  @Column({ name: 'purchase_cover_days', type: 'int', default: 30 })
  purchaseCoverDays: number;

  // ── insight thresholds ──
  @Column(decimal('sales_drop_pct', 5))
  salesDropPct: number;

  @Column(decimal('sales_rise_pct', 5))
  salesRisePct: number;

  @Column(decimal('profit_drop_pct', 5))
  profitDropPct: number;

  @Column(decimal('margin_drop_points', 2))
  marginDropPoints: number;

  @Column(decimal('slow_value_critical_pct', 25))
  slowValueCriticalPct: number;

  @Column(decimal('top_item_share_pct', 30))
  topItemSharePct: number;

  @Column(decimal('top_customer_share_pct', 25))
  topCustomerSharePct: number;

  @Column(decimal('returns_ratio_pct', 5))
  returnsRatioPct: number;

  @Column(decimal('expenses_profit_warn_pct', 60))
  expensesProfitWarnPct: number;

  @Column(decimal('pos_cash_diff_min', 1))
  posCashDiffMin: number;

  // ── alerts ──
  @Column({ name: 'alert_credit_limit', default: true })
  alertCreditLimit: boolean;

  @Column({ name: 'alert_customer_balance', default: false })
  alertCustomerBalance: boolean;

  @Column(decimal('customer_balance_threshold', 0))
  customerBalanceThreshold: number;

  @Column({ name: 'alert_supplier_balance', default: false })
  alertSupplierBalance: boolean;

  @Column(decimal('supplier_balance_threshold', 0))
  supplierBalanceThreshold: number;

  @Column({ name: 'alert_month_expenses', default: false })
  alertMonthExpenses: boolean;

  @Column(decimal('month_expenses_threshold', 0))
  monthExpensesThreshold: number;

  @Column({ name: 'alert_negative_treasury', default: true })
  alertNegativeTreasury: boolean;

  @Column({ name: 'alert_negative_stock', default: true })
  alertNegativeStock: boolean;

  @Column({ name: 'alert_expiring_lots', default: true })
  alertExpiringLots: boolean;

  @Column({ name: 'expiry_days', type: 'int', default: 30 })
  expiryDays: number;

  @Column({ name: 'alert_installments', default: true })
  alertInstallments: boolean;

  /** "Due soon" horizon for installments. */
  @Column({ name: 'installment_days', type: 'int', default: 7 })
  installmentDays: number;

  @Column({ name: 'alert_cheques', default: true })
  alertCheques: boolean;

  /** Cheques due within this many days (overdue ones are always listed). */
  @Column({ name: 'cheque_days', type: 'int', default: 3 })
  chequeDays: number;

  /** Let the background job (ANALYTICS_ALERTS_INTERVAL_SEC) create the notifications. */
  @Column({ name: 'auto_notify', default: false })
  autoNotify: boolean;

  /** Notification recipients; empty = every user holding analytics/alerts/read. */
  @Column({ name: 'notify_user_ids', type: 'uuid', array: true, default: '{}' })
  notifyUserIds: string[];
}
