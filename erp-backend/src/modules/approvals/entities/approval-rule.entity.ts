import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

/** Business documents the approval engine knows about. */
export enum ApprovalDocumentType {
  PURCHASE_ORDER = 'purchase_order',
  VENDOR_BILL = 'vendor_bill',
  /** Outbound payments (supplier payments and customer refunds). */
  PAYMENT = 'payment',
  /** Treasury payment vouchers (سند صرف). */
  TREASURY_VOUCHER = 'treasury_voucher',
  SALES_DISCOUNT = 'sales_discount',
  SALES_ORDER = 'sales_order',
  JOURNAL_ENTRY = 'journal_entry',
  OTHER = 'other',
}

/**
 * An approval policy for one document type: documents whose base-currency
 * amount is above `minAmount` (and up to `maxAmount` when set) need every
 * level approved, in order. When several rules match, the one with the
 * highest `minAmount` wins (then the lowest `priority`).
 */
@Entity('approval_rules')
@Index(['tenantId', 'documentType'])
export class ApprovalRule extends TenantBaseEntity {
  @Column()
  name: string;

  @Column({ name: 'document_type', type: 'enum', enum: ApprovalDocumentType })
  documentType: ApprovalDocumentType;

  /** The rule applies to amounts strictly greater than this (base currency). */
  @Column({ name: 'min_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  minAmount: number;

  /** Optional upper bound (inclusive) so different bands can have different levels. */
  @Column({ name: 'max_amount', type: 'decimal', precision: 18, scale: 4, nullable: true })
  maxAmount: number | null;

  @Column({ default: 100 })
  priority: number;

  /** May the requester approve their own document? Off by default (segregation of duties). */
  @Column({ name: 'allow_self_approval', default: false })
  allowSelfApproval: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ nullable: true })
  description: string;

  @OneToMany(() => ApprovalRuleLevel, (l) => l.rule, { cascade: true, eager: true })
  levels: ApprovalRuleLevel[];
}

/** One approval step: a role or a list of users, with a minimum number of approvers. */
@Entity('approval_rule_levels')
export class ApprovalRuleLevel extends BaseEntity {
  @Column({ name: 'rule_id', type: 'uuid' })
  ruleId: string;

  /** 1-based order of the level. */
  @Column()
  sequence: number;

  @Column({ nullable: true })
  name: string;

  /** Members of this role may approve the level. */
  @Column({ name: 'role_id', type: 'uuid', nullable: true })
  roleId: string | null;

  /** These users may approve the level (in addition to the role members). */
  @Column({ name: 'user_ids', type: 'uuid', array: true, default: '{}' })
  userIds: string[];

  /** Distinct approvals needed to pass the level. */
  @Column({ name: 'min_approvers', default: 1 })
  minApprovers: number;

  @ManyToOne(() => ApprovalRule, (r) => r.levels, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rule_id' })
  rule: ApprovalRule;
}
