import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/**
 * Per-tenant default accounts and journals used for automatic posting
 * (Odoo's company accounting configuration / property accounts).
 */
@Entity('accounting_settings')
@Unique(['tenantId'])
export class AccountingSettings extends TenantBaseEntity {
  @Column({ name: 'receivable_account_id', type: 'uuid', nullable: true })
  receivableAccountId: string;

  @Column({ name: 'payable_account_id', type: 'uuid', nullable: true })
  payableAccountId: string;

  @Column({ name: 'sales_account_id', type: 'uuid', nullable: true })
  salesAccountId: string;

  @Column({ name: 'purchase_account_id', type: 'uuid', nullable: true })
  purchaseAccountId: string;

  @Column({ name: 'inventory_account_id', type: 'uuid', nullable: true })
  inventoryAccountId: string;

  @Column({ name: 'cogs_account_id', type: 'uuid', nullable: true })
  cogsAccountId: string;

  @Column({ name: 'stock_adjustment_account_id', type: 'uuid', nullable: true })
  stockAdjustmentAccountId: string;

  @Column({ name: 'output_tax_account_id', type: 'uuid', nullable: true })
  outputTaxAccountId: string;

  @Column({ name: 'input_tax_account_id', type: 'uuid', nullable: true })
  inputTaxAccountId: string;

  @Column({ name: 'cash_account_id', type: 'uuid', nullable: true })
  cashAccountId: string;

  @Column({ name: 'bank_account_id', type: 'uuid', nullable: true })
  bankAccountId: string;

  @Column({ name: 'retained_earnings_account_id', type: 'uuid', nullable: true })
  retainedEarningsAccountId: string;

  @Column({ name: 'depreciation_expense_account_id', type: 'uuid', nullable: true })
  depreciationExpenseAccountId: string;

  @Column({ name: 'accumulated_depreciation_account_id', type: 'uuid', nullable: true })
  accumulatedDepreciationAccountId: string;

  @Column({ name: 'asset_disposal_account_id', type: 'uuid', nullable: true })
  assetDisposalAccountId: string;

  /** Entries dated on or before this date can no longer be posted (Odoo lock date). */
  @Column({ name: 'lock_date', type: 'date', nullable: true })
  lockDate: string;
}
