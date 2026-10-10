import { Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { PromotionAppliesTo } from '../engine/promotion-engine';

/** Columns shared by every promotion rule type. */
export abstract class PromotionRuleBase extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'valid_from', type: 'date', nullable: true })
  validFrom: string | null;

  @Column({ name: 'valid_to', type: 'date', nullable: true })
  validTo: string | null;

  /** sales = sales invoices / orders, pos = POS orders, both. */
  @Column({ name: 'applies_to', default: 'both' })
  appliesTo: PromotionAppliesTo;

  /** Branches the rule is limited to; empty = every branch. */
  @Column({ name: 'branch_ids', type: 'uuid', array: true, default: '{}' })
  branchIds: string[];

  /** 0 = Sunday ... 6 = Saturday; empty = every day. */
  @Column({ type: 'int', array: true, default: '{}' })
  weekdays: number[];

  /** Hour window HH:mm (start inclusive, end exclusive); null = all day. */
  @Column({ name: 'start_time', type: 'varchar', length: 5, nullable: true })
  startTime: string | null;

  @Column({ name: 'end_time', type: 'varchar', length: 5, nullable: true })
  endTime: string | null;

  @Column({ nullable: true })
  notes: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;
}
