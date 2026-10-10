import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';
import { PaymentPartnerType } from './payment.entity';

export enum WriteOffStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

/**
 * What the written-off balance is booked as:
 * - write_off: customer bad debt (expense) / supplier residual (income)
 * - discount: discount allowed to the customer / received from the supplier
 * - custom: the explicit `accountId` of the document
 */
export enum WriteOffKind {
  WRITE_OFF = 'write_off',
  DISCOUNT = 'discount',
  CUSTOM = 'custom',
}

/**
 * Partner balance write-off (إعدام / تسوية رصيد, Instasoft writeoff): closes the
 * residual of open customer invoices against an expense account, or of open
 * supplier bills against an income account. Posting reconciles the documents
 * exactly like a payment allocation; cancelling reverses it.
 */
@Entity('partner_write_offs')
export class PartnerWriteOff extends TenantBaseEntity {
  @Column({ name: 'write_off_number' })
  writeOffNumber: string;

  @Column({ name: 'partner_type', type: 'enum', enum: PaymentPartnerType })
  partnerType: PaymentPartnerType;

  @Column({ name: 'partner_id', type: 'uuid' })
  partnerId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'enum', enum: WriteOffKind, default: WriteOffKind.WRITE_OFF })
  kind: WriteOffKind;

  /** Counterpart account for kind = custom (overrides the settings account). */
  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  amount: number;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @Column({ type: 'enum', enum: WriteOffStatus, default: WriteOffStatus.DRAFT })
  status: WriteOffStatus;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date | null;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => PartnerWriteOffLine, (l) => l.writeOff, { cascade: true })
  lines: PartnerWriteOffLine[];
}

/** Amount written off on one open invoice (customer) or bill (supplier). */
@Entity('partner_write_off_lines')
export class PartnerWriteOffLine extends BaseEntity {
  @Column({ name: 'write_off_id', type: 'uuid' })
  writeOffId: string;

  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'invoice_number', type: 'varchar', nullable: true })
  invoiceNumber: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @ManyToOne(() => PartnerWriteOff, (w) => w.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'write_off_id' })
  writeOff: PartnerWriteOff;
}
