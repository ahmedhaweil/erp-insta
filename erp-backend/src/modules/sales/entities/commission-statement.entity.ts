import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum CommissionStatementStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

export interface CommissionStatementLine {
  invoiceId: string;
  invoiceNumber: string;
  productCategoryId: string | null;
  basis: string;
  baseAmount: number;
  ruleId: string | null;
  rate: number;
  commission: number;
}

/** Commission statement of a sales rep for a period (accrued when posted). */
@Entity('commission_statements')
export class CommissionStatement extends TenantBaseEntity {
  @Column({ name: 'statement_number' })
  statementNumber: string;

  @Column({ name: 'sales_rep_id', type: 'uuid' })
  salesRepId: string;

  @Column({ name: 'period_from', type: 'date' })
  periodFrom: string;

  @Column({ name: 'period_to', type: 'date' })
  periodTo: string;

  @Column({ name: 'collected_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  collectedAmount: number;

  @Column({ name: 'invoiced_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  invoicedAmount: number;

  @Column({ name: 'commission_amount', type: 'decimal', precision: 18, scale: 4, default: 0 })
  commissionAmount: number;

  @Column({
    type: 'enum',
    enum: CommissionStatementStatus,
    default: CommissionStatementStatus.DRAFT,
  })
  status: CommissionStatementStatus;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  lines: CommissionStatementLine[];

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;
}
