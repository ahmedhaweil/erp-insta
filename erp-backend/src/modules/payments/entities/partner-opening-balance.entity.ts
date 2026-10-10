import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';
import { PaymentPartnerType } from './payment.entity';

export enum OpeningBalanceStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

/**
 * Customer / supplier opening balances (أرصدة أول المدة, Instasoft
 * first_balance). Posting creates one open item per line (a line-less sales
 * invoice / credit note, or vendor bill / refund) so that aged balances,
 * statements and payment allocation work on opening balances, and posts the
 * balances against the opening balance equity account.
 */
@Entity('partner_opening_balances')
export class PartnerOpeningBalance extends TenantBaseEntity {
  @Column({ name: 'document_number' })
  documentNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: OpeningBalanceStatus, default: OpeningBalanceStatus.DRAFT })
  status: OpeningBalanceStatus;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  /** Sum of customer lines (signed: positive = customers owe us). */
  @Column({ name: 'customer_total', type: 'decimal', precision: 18, scale: 4, default: 0 })
  customerTotal: number;

  /** Sum of supplier lines (signed: positive = we owe suppliers). */
  @Column({ name: 'supplier_total', type: 'decimal', precision: 18, scale: 4, default: 0 })
  supplierTotal: number;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => PartnerOpeningBalanceLine, (l) => l.document, { cascade: true })
  lines: PartnerOpeningBalanceLine[];
}

@Entity('partner_opening_balance_lines')
export class PartnerOpeningBalanceLine extends BaseEntity {
  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({ name: 'partner_type', type: 'enum', enum: PaymentPartnerType })
  partnerType: PaymentPartnerType;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId: string;

  /**
   * Signed balance in the partner's natural direction: positive = the
   * customer owes us / we owe the supplier; negative = an advance / credit.
   */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  /** Date the original document was issued (ageing); defaults to the document date. */
  @Column({ name: 'original_date', type: 'date', nullable: true })
  originalDate: string | null;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  /** Open item created on posting (sales invoice / credit note or vendor bill / refund). */
  @Column({ name: 'open_item_id', type: 'uuid', nullable: true })
  openItemId: string | null;

  @ManyToOne(() => PartnerOpeningBalance, (d) => d.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: PartnerOpeningBalance;
}
