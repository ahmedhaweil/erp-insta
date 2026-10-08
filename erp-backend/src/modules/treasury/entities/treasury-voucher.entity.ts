import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

/** receipt = سند قبض (money in), payment = سند صرف (money out). */
export enum VoucherType {
  RECEIPT = 'receipt',
  PAYMENT = 'payment',
}

export enum VoucherStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

/** Receipt/payment voucher for money not tied to invoices (expenses, other income...). */
@Entity('treasury_vouchers')
export class TreasuryVoucher extends TenantBaseEntity {
  @Column({ name: 'voucher_number' })
  voucherNumber: string;

  @Column({ type: 'enum', enum: VoucherType })
  type: VoucherType;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'treasury_id', type: 'uuid' })
  treasuryId: string;

  @Column({ type: 'enum', enum: VoucherStatus, default: VoucherStatus.DRAFT })
  status: VoucherStatus;

  /** Total in the voucher (treasury) currency. */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  amount: number;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string;

  @Column({ name: 'exchange_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  exchangeRate: number;

  /** Free-text payer / payee. */
  @Column({ name: 'counterparty_name', nullable: true })
  counterpartyName: string;

  @Column({ nullable: true })
  reference: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  /** Set when the voucher was generated from a bank statement line. */
  @Column({ name: 'statement_line_id', type: 'uuid', nullable: true })
  statementLineId: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'posted_at', type: 'timestamptz', nullable: true })
  postedAt: Date;

  @OneToMany(() => TreasuryVoucherLine, (l) => l.voucher, { cascade: true })
  lines: TreasuryVoucherLine[];
}

@Entity('treasury_voucher_lines')
export class TreasuryVoucherLine extends BaseEntity {
  @Column({ name: 'voucher_id', type: 'uuid' })
  voucherId: string;

  /** Counterpart GL account (expense, income, any balance sheet account). */
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  @ManyToOne(() => TreasuryVoucher, (v) => v.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'voucher_id' })
  voucher: TreasuryVoucher;
}
