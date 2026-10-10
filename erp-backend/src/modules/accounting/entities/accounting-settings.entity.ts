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

  /** Cheques/notes received and held in the portfolio (أوراق القبض). */
  @Column({ name: 'notes_receivable_account_id', type: 'uuid', nullable: true })
  notesReceivableAccountId: string;

  /** Cheques deposited at the bank and awaiting clearance. */
  @Column({ name: 'cheques_under_collection_account_id', type: 'uuid', nullable: true })
  chequesUnderCollectionAccountId: string;

  /** Cheques/notes issued to suppliers and not yet cleared (أوراق الدفع). */
  @Column({ name: 'notes_payable_account_id', type: 'uuid', nullable: true })
  notesPayableAccountId: string;

  /** Realised and unrealised exchange gains. */
  @Column({ name: 'fx_gain_account_id', type: 'uuid', nullable: true })
  fxGainAccountId: string;

  /** Realised and unrealised exchange losses. */
  @Column({ name: 'fx_loss_account_id', type: 'uuid', nullable: true })
  fxLossAccountId: string;

  /** Bank fees recorded during reconciliation or cheque bounce. */
  @Column({ name: 'bank_charges_account_id', type: 'uuid', nullable: true })
  bankChargesAccountId: string;

  /** Tax withheld by customers on our invoices (asset). */
  @Column({ name: 'withholding_tax_receivable_account_id', type: 'uuid', nullable: true })
  withholdingTaxReceivableAccountId: string;

  /** Tax we withhold from supplier payments (liability). */
  @Column({ name: 'withholding_tax_payable_account_id', type: 'uuid', nullable: true })
  withholdingTaxPayableAccountId: string;

  /** Contra-revenue account for customer returns; falls back to sales. */
  @Column({ name: 'sales_return_account_id', type: 'uuid', nullable: true })
  salesReturnAccountId: string;

  /** Cash/early-payment discounts allowed. */
  @Column({ name: 'sales_discount_account_id', type: 'uuid', nullable: true })
  salesDiscountAccountId: string;

  /** Gross salaries and allowances. */
  @Column({ name: 'salaries_expense_account_id', type: 'uuid', nullable: true })
  salariesExpenseAccountId: string;

  /** Net salaries owed to employees. */
  @Column({ name: 'salaries_payable_account_id', type: 'uuid', nullable: true })
  salariesPayableAccountId: string;

  /** Employer share of social insurance / GOSI. */
  @Column({ name: 'social_insurance_expense_account_id', type: 'uuid', nullable: true })
  socialInsuranceExpenseAccountId: string;

  /** Employee + employer social insurance owed. */
  @Column({ name: 'social_insurance_payable_account_id', type: 'uuid', nullable: true })
  socialInsurancePayableAccountId: string;

  /** Salary income tax withheld. */
  @Column({ name: 'payroll_tax_payable_account_id', type: 'uuid', nullable: true })
  payrollTaxPayableAccountId: string;

  /** Loans and salary advances to employees. */
  @Column({ name: 'employee_advances_account_id', type: 'uuid', nullable: true })
  employeeAdvancesAccountId: string;

  /** Sales representatives' commissions. */
  @Column({ name: 'commission_expense_account_id', type: 'uuid', nullable: true })
  commissionExpenseAccountId: string;

  /** Commissions owed to sales representatives. */
  @Column({ name: 'commission_payable_account_id', type: 'uuid', nullable: true })
  commissionPayableAccountId: string;

  /** Interest/financing income on instalment sales. */
  @Column({ name: 'installment_interest_account_id', type: 'uuid', nullable: true })
  installmentInterestAccountId: string;

  /** Labour and overhead absorbed into manufactured goods. */
  @Column({ name: 'manufacturing_overhead_account_id', type: 'uuid', nullable: true })
  manufacturingOverheadAccountId: string;

  /** Contra-expense for returns of non-stock purchases; falls back to purchase. */
  @Column({ name: 'purchase_return_account_id', type: 'uuid', nullable: true })
  purchaseReturnAccountId: string;

  /** Discounts received from suppliers on settlement (other income / contra-purchases). */
  @Column({ name: 'purchase_discount_account_id', type: 'uuid', nullable: true })
  purchaseDiscountAccountId: string;

  /** Customer balances written off as uncollectible. */
  @Column({ name: 'bad_debt_expense_account_id', type: 'uuid', nullable: true })
  badDebtExpenseAccountId: string;

  /** Supplier residual balances written off (income). */
  @Column({ name: 'write_off_income_account_id', type: 'uuid', nullable: true })
  writeOffIncomeAccountId: string;

  /** Goods given away as donations / charity. */
  @Column({ name: 'donations_expense_account_id', type: 'uuid', nullable: true })
  donationsExpenseAccountId: string;

  /** Counterpart of customer/supplier opening balances; falls back to retained earnings. */
  @Column({ name: 'opening_balance_equity_account_id', type: 'uuid', nullable: true })
  openingBalanceEquityAccountId: string;

  /** Entries dated on or before this date can no longer be posted (Odoo lock date). */
  @Column({ name: 'lock_date', type: 'date', nullable: true })
  lockDate: string;
}
