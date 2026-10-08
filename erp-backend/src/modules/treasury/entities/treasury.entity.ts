import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum TreasuryType {
  CASH = 'cash',
  BANK = 'bank',
}

/**
 * A cash box (خزينة) or bank account (حساب بنكي). Each treasury has its own
 * GL account; its balance is the sum of posted journal lines on that account
 * (the opening balance is posted as an opening entry when accounting is on).
 */
@Entity('treasuries')
@Index(['tenantId', 'code'], { unique: true })
export class Treasury extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ type: 'enum', enum: TreasuryType })
  type: TreasuryType;

  /** GL account that holds this treasury's money (a leaf asset account). */
  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  /** Null means the base currency. */
  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  @Column({ name: 'bank_name', nullable: true })
  bankName: string;

  @Column({ name: 'bank_branch', nullable: true })
  bankBranch: string;

  @Column({ name: 'account_number', nullable: true })
  accountNumber: string;

  @Column({ nullable: true })
  iban: string;

  @Column({ name: 'swift_code', nullable: true })
  swiftCode: string;

  /** In the treasury currency. */
  @Column({ name: 'opening_balance', type: 'decimal', precision: 18, scale: 4, default: 0 })
  openingBalance: number;

  @Column({ name: 'opening_date', type: 'date', nullable: true })
  openingDate: string;

  /** Base-currency units per treasury-currency unit used for the opening entry. */
  @Column({ name: 'opening_rate', type: 'decimal', precision: 12, scale: 6, default: 1 })
  openingRate: number;

  /** User responsible for the cash box; access restriction can build on it later. */
  @Column({ name: 'custodian_user_id', type: 'uuid', nullable: true })
  custodianUserId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ nullable: true })
  notes: string;
}
