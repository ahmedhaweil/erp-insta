import { Column, Entity, Index, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { NotificationType } from '@modules/notifications/entities/notification.entity';
import { AlertType } from '../alert-types';

/** A per-tenant alert: what to check, its threshold and who is notified. */
@Entity('alert_rules')
export class AlertRule extends TenantBaseEntity {
  @Column({ type: 'enum', enum: AlertType })
  type: AlertType;

  @Column()
  name: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Days threshold (meaning depends on the type; null = type default). */
  @Column({ name: 'threshold_days', type: 'int', nullable: true })
  thresholdDays: number | null;

  /** Hours threshold (POS sessions; null = type default). */
  @Column({ name: 'threshold_hours', type: 'int', nullable: true })
  thresholdHours: number | null;

  /** Type-specific options (chequeType, minAmount, warehouseId). */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  params: Record<string, unknown>;

  @Column({ name: 'recipient_user_ids', type: 'jsonb', default: () => "'[]'" })
  recipientUserIds: string[];

  @Column({ name: 'recipient_role_ids', type: 'jsonb', default: () => "'[]'" })
  recipientRoleIds: string[];

  /** Notification severity (default: the type's). */
  @Column({ type: 'enum', enum: NotificationType, nullable: true })
  severity: NotificationType | null;

  @Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @Column({ name: 'last_match_count', type: 'int', default: 0 })
  lastMatchCount: number;
}

/**
 * One alert sent for one record to one user on one day; the unique key makes
 * a record alert at most once per day per user and rule.
 */
@Entity('alert_deliveries')
@Unique('UQ_alert_delivery_daily', ['tenantId', 'ruleId', 'recordKey', 'userId', 'alertDate'])
@Index(['tenantId', 'alertDate'])
export class AlertDelivery extends TenantBaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  ruleId: string;

  @Column({ name: 'alert_type', type: 'varchar' })
  alertType: string;

  @Column({ name: 'record_key' })
  recordKey: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'alert_date', type: 'date' })
  alertDate: string;

  @Column({ name: 'notification_id', type: 'uuid', nullable: true })
  notificationId: string | null;
}
