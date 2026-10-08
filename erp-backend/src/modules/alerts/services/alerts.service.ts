import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThanOrEqual, Repository } from 'typeorm';
import { NotificationsService } from '@modules/notifications/services/notifications.service';
import { addDays, today } from '@shared/utils/document-totals.util';
import { ALERT_TYPES, ALERT_TYPE_MAP, AlertType } from '../alert-types';
import { AlertDelivery, AlertRule } from '../entities/alert-rule.entity';
import { AlertDeliveryQueryDto, CreateAlertRuleDto, ScanAlertsDto, UpdateAlertRuleDto } from '../dto/alerts.dto';
import { AlertMatch, AlertSourcesService } from './alert-sources.service';

/** Items listed in a notification body (all are in `data.items`, up to MAX_ITEMS). */
const BODY_ITEMS = 10;
const MAX_ITEMS = 100;

export interface RuleScanResult {
  ruleId: string;
  type: AlertType;
  name: string;
  matches: number;
  /** Records alerted for the first time today (per user, de-duplicated). */
  newRecords: number;
  notifiedUsers: number;
  items?: AlertMatch[];
  error?: string;
}

export interface ScanOptions extends ScanAlertsDto {
  asOf?: string;
  now?: Date;
}

/**
 * Per-tenant alert rules and their scan: each active rule queries its
 * records, and every recipient gets one in-app notification listing the
 * records not yet alerted to them today.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(AlertRule) private readonly ruleRepo: Repository<AlertRule>,
    @InjectRepository(AlertDelivery) private readonly deliveryRepo: Repository<AlertDelivery>,
    private readonly dataSource: DataSource,
    private readonly sources: AlertSourcesService,
    private readonly notifications: NotificationsService,
  ) {}

  types() {
    return ALERT_TYPES;
  }

  findRules(tenantId: string): Promise<AlertRule[]> {
    return this.ruleRepo.find({ where: { tenantId }, order: { type: 'ASC', createdAt: 'ASC' } });
  }

  async findRule(tenantId: string, id: string): Promise<AlertRule> {
    const rule = await this.ruleRepo.findOne({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException('Alert rule not found');
    return rule;
  }

  async createRule(tenantId: string, dto: CreateAlertRuleDto): Promise<AlertRule> {
    const def = ALERT_TYPE_MAP.get(dto.type);
    if (!def) throw new BadRequestException(`Unknown alert type ${dto.type}`);
    await this.assertRecipients(tenantId, dto.recipientUserIds, dto.recipientRoleIds);
    return this.ruleRepo.save(
      this.ruleRepo.create({
        tenantId,
        type: dto.type,
        name: dto.name?.trim() || def.title.ar,
        isActive: dto.isActive ?? true,
        thresholdDays: dto.thresholdDays ?? null,
        thresholdHours: dto.thresholdHours ?? null,
        params: dto.params ?? {},
        recipientUserIds: dto.recipientUserIds ?? [],
        recipientRoleIds: dto.recipientRoleIds ?? [],
        severity: dto.severity ?? null,
      }),
    );
  }

  async updateRule(tenantId: string, id: string, dto: UpdateAlertRuleDto): Promise<AlertRule> {
    const rule = await this.findRule(tenantId, id);
    if (dto.type && dto.type !== rule.type) throw new BadRequestException('The type of a rule cannot be changed');
    await this.assertRecipients(tenantId, dto.recipientUserIds, dto.recipientRoleIds);
    const { type: _type, ...changes } = dto;
    Object.assign(rule, changes);
    if (dto.name !== undefined && !dto.name.trim()) rule.name = ALERT_TYPE_MAP.get(rule.type)!.title.ar;
    return this.ruleRepo.save(rule);
  }

  async removeRule(tenantId: string, id: string): Promise<void> {
    const rule = await this.findRule(tenantId, id);
    await this.deliveryRepo.delete({ tenantId, ruleId: rule.id });
    await this.ruleRepo.remove(rule);
  }

  /** Creates one rule per alert type the tenant does not have yet (default thresholds, admins notified). */
  async createDefaults(tenantId: string): Promise<AlertRule[]> {
    const existing = new Set((await this.findRules(tenantId)).map((r) => r.type));
    const created: AlertRule[] = [];
    for (const def of ALERT_TYPES) {
      if (existing.has(def.type)) continue;
      created.push(await this.createRule(tenantId, { type: def.type }));
    }
    return created;
  }

  findDeliveries(tenantId: string, query: AlertDeliveryQueryDto = {}): Promise<AlertDelivery[]> {
    const where: Record<string, unknown> = {
      tenantId,
      alertDate: MoreThanOrEqual(query.from ?? addDays(today(), -7)),
    };
    if (query.ruleId) where.ruleId = query.ruleId;
    return this.deliveryRepo.find({ where, order: { createdAt: 'DESC' }, take: query.limit ?? 200 });
  }

  /** Runs the tenant's active rules (or one rule). */
  async scan(tenantId: string, options: ScanOptions = {}): Promise<RuleScanResult[]> {
    const rules = options.ruleId
      ? [await this.findRule(tenantId, options.ruleId)]
      : await this.ruleRepo.find({ where: { tenantId, isActive: true }, order: { type: 'ASC' } });
    const asOf = options.asOf ?? today();
    const now = options.now ?? new Date();
    const results: RuleScanResult[] = [];
    for (const rule of rules) {
      results.push(await this.scanRule(rule, asOf, now, !!options.dryRun));
    }
    return results;
  }

  private async scanRule(rule: AlertRule, asOf: string, now: Date, dryRun: boolean): Promise<RuleScanResult> {
    const def = ALERT_TYPE_MAP.get(rule.type)!;
    const result: RuleScanResult = {
      ruleId: rule.id,
      type: rule.type,
      name: rule.name,
      matches: 0,
      newRecords: 0,
      notifiedUsers: 0,
    };
    const matches = await this.sources.find(rule.type, {
      tenantId: rule.tenantId,
      days: rule.thresholdDays ?? def.days?.default ?? 0,
      hours: rule.thresholdHours ?? def.hours?.default ?? 12,
      params: rule.params ?? {},
      asOf,
      now,
    });
    result.matches = matches.length;
    if (dryRun) {
      result.items = matches;
      return result;
    }

    if (matches.length) {
      const recipients = await this.resolveRecipients(rule);
      const fresh = new Set<string>();
      for (const userId of recipients) {
        const inserted = await this.claimDeliveries(rule, userId, asOf, matches.map((m) => m.recordKey));
        if (!inserted.length) continue;
        inserted.forEach((k) => fresh.add(k));
        const items = matches.filter((m) => inserted.includes(m.recordKey));
        const notification = await this.notifications.create(rule.tenantId, {
          userId,
          title: rule.name || `${def.title.ar} / ${def.title.en}`,
          body: this.body(items),
          type: rule.severity ?? def.severity,
          data: {
            source: 'alert',
            alertType: rule.type,
            ruleId: rule.id,
            title: def.title,
            link: def.link,
            count: items.length,
            items: items.slice(0, MAX_ITEMS).map((i) => ({ key: i.recordKey, label: i.label, ...i.data })),
          },
        });
        await this.deliveryRepo
          .createQueryBuilder()
          .update(AlertDelivery)
          .set({ notificationId: notification.id })
          .where('tenant_id = :tenantId AND rule_id = :ruleId AND user_id = :userId AND alert_date = :asOf', {
            tenantId: rule.tenantId,
            ruleId: rule.id,
            userId,
            asOf,
          })
          .andWhere('notification_id IS NULL')
          .execute();
        result.notifiedUsers++;
      }
      result.newRecords = fresh.size;
    }

    rule.lastRunAt = now;
    rule.lastMatchCount = matches.length;
    await this.ruleRepo.save(rule);
    return result;
  }

  private body(items: AlertMatch[]): string {
    const lines = items.slice(0, BODY_ITEMS).map((i) => i.label);
    const more = items.length - lines.length;
    return `(${items.length}) ${lines.join(' ; ')}${more > 0 ? ` ; +${more}` : ''}`;
  }

  /**
   * Records today's deliveries and returns only the record keys not yet
   * delivered to this user today (insert ... on conflict do nothing), so two
   * concurrent scans cannot notify the same record twice.
   */
  private async claimDeliveries(rule: AlertRule, userId: string, asOf: string, keys: string[]): Promise<string[]> {
    const rows: { record_key: string }[] = await this.dataSource.query(
      `INSERT INTO alert_deliveries (tenant_id, rule_id, alert_type, record_key, user_id, alert_date)
       SELECT $1, $2, $3, k, $4, $5::date FROM unnest($6::varchar[]) AS k
       ON CONFLICT ON CONSTRAINT "UQ_alert_delivery_daily" DO NOTHING
       RETURNING record_key`,
      [rule.tenantId, rule.id, rule.type, userId, asOf, keys],
    );
    return rows.map((r) => r.record_key);
  }

  /** Users of the rule plus active holders of its roles; tenant administrators when none are set. */
  async resolveRecipients(rule: AlertRule): Promise<string[]> {
    const userIds = rule.recipientUserIds ?? [];
    const roleIds = rule.recipientRoleIds ?? [];
    let rows: { id: string }[];
    if (userIds.length || roleIds.length) {
      rows = await this.dataSource.query(
        `SELECT u.id FROM users u
          WHERE u.tenant_id = $1 AND u.is_active = true
            AND (u.id = ANY($2::uuid[]) OR EXISTS (
                  SELECT 1 FROM user_roles ur
                   WHERE ur.user_id = u.id AND ur.role_id = ANY($3::uuid[])
                     AND (ur.valid_from IS NULL OR ur.valid_from <= now())
                     AND (ur.valid_to IS NULL OR ur.valid_to >= now())))
          ORDER BY u.id`,
        [rule.tenantId, userIds, roleIds],
      );
    } else {
      rows = await this.dataSource.query(
        `SELECT DISTINCT u.id FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
          WHERE u.tenant_id = $1 AND u.is_active = true AND r.tenant_id = $1 AND r.is_system_role = true
          ORDER BY u.id`,
        [rule.tenantId],
      );
    }
    return rows.map((r) => r.id);
  }

  private async assertRecipients(tenantId: string, userIds?: string[], roleIds?: string[]): Promise<void> {
    if (userIds?.length) {
      const rows: { n: string }[] = await this.dataSource.query(
        `SELECT COUNT(*) AS n FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, userIds],
      );
      if (Number(rows[0]?.n) !== new Set(userIds).size) throw new BadRequestException('Unknown recipient user');
    }
    if (roleIds?.length) {
      const rows: { n: string }[] = await this.dataSource.query(
        `SELECT COUNT(*) AS n FROM roles WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, roleIds],
      );
      if (Number(rows[0]?.n) !== new Set(roleIds).size) throw new BadRequestException('Unknown recipient role');
    }
  }

  /** Tenants with at least one active rule (scheduler). */
  async tenantsToScan(): Promise<string[]> {
    const rows: { tenant_id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT r.tenant_id FROM alert_rules r
         JOIN tenants t ON t.id = r.tenant_id
        WHERE r.is_active = true AND t.is_active = true
        ORDER BY r.tenant_id`,
    );
    return rows.map((r) => r.tenant_id);
  }

  logFailure(tenantId: string, err: unknown) {
    this.logger.warn(`Alert scan of tenant ${tenantId} failed: ${(err as Error).message}`);
  }
}
