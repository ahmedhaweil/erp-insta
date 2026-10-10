import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

export type FuelShiftStatus = 'open' | 'closed';

const money = (name: string) =>
  ({ name, type: 'decimal', precision: 18, scale: 4, default: 0 }) as const;

/** Pump attendant shift (Instasoft "patrol_session"), numbered FSH-000001. */
@Entity('fuel_shifts')
export class FuelShift extends TenantBaseEntity {
  @Column({ name: 'shift_number' })
  shiftNumber: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ default: 'open' })
  status: FuelShiftStatus;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy: string | null;

  /** Accounting date of the sales (close date). */
  @Column({ type: 'date', nullable: true })
  date: string | null;

  @Column({ ...money('total_liters') })
  totalLiters: number;

  /** Pump amount, VAT included. */
  @Column({ ...money('total_amount') })
  totalAmount: number;

  @Column({ ...money('net_amount') })
  netAmount: number;

  @Column({ ...money('tax_amount') })
  taxAmount: number;

  /** Coupons on nozzles plus coupons received for the shift as a whole. */
  @Column({ ...money('coupon_amount') })
  couponAmount: number;

  /** Coupons not attributed to a nozzle. */
  @Column({ ...money('shift_coupon_amount') })
  shiftCouponAmount: number;

  @Column({ ...money('card_amount') })
  cardAmount: number;

  @Column({ ...money('credit_amount') })
  creditAmount: number;

  @Column({ ...money('cash_expected') })
  cashExpected: number;

  @Column({ name: 'cash_counted', type: 'decimal', precision: 18, scale: 4, nullable: true })
  cashCounted: number | null;

  /** Counted minus expected (negative = shortage). */
  @Column({ ...money('cash_difference') })
  cashDifference: number;

  @Column({ ...money('total_cost') })
  totalCost: number;

  @Column({ ...money('total_margin') })
  totalMargin: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @OneToMany(() => FuelShiftLine, (l) => l.shift)
  lines: FuelShiftLine[];

  @OneToMany(() => FuelShiftCredit, (l) => l.shift)
  credits: FuelShiftCredit[];
}

/** One nozzle in a shift: meters, liters, money and margin. */
@Entity('fuel_shift_lines')
export class FuelShiftLine extends BaseEntity {
  @Column({ name: 'shift_id', type: 'uuid' })
  shiftId: string;

  @Column({ name: 'nozzle_id', type: 'uuid' })
  nozzleId: string;

  @Column({ name: 'tank_id', type: 'uuid' })
  tankId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ name: 'opening_reading', type: 'decimal', precision: 18, scale: 4 })
  openingReading: number;

  @Column({ name: 'closing_reading', type: 'decimal', precision: 18, scale: 4, nullable: true })
  closingReading: number | null;

  @Column({ name: 'meter_reset', default: false })
  meterReset: boolean;

  /** Reading at which the meter rolled over / was replaced (meter reset only). */
  @Column({ name: 'rollover_at', type: 'decimal', precision: 18, scale: 4, nullable: true })
  rolloverAt: number | null;

  @Column({ ...money('liters') })
  liters: number;

  /** Pump price per liter, VAT included, fixed when the shift opens. */
  @Column({ name: 'unit_price', type: 'decimal', precision: 18, scale: 4 })
  unitPrice: number;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate: number;

  @Column({ ...money('amount') })
  amount: number;

  @Column({ ...money('net_amount') })
  netAmount: number;

  @Column({ ...money('tax_amount') })
  taxAmount: number;

  @Column({ ...money('coupon_amount') })
  couponAmount: number;

  @Column({ ...money('unit_cost') })
  unitCost: number;

  @Column({ ...money('cost') })
  cost: number;

  /** Net (VAT-exclusive) sales minus average cost. */
  @Column({ ...money('margin') })
  margin: number;

  @ManyToOne(() => FuelShift, (s) => s.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shift_id' })
  shift: FuelShift;
}

/** Fuel sold on account during the shift; invoiced to the customer on close. */
@Entity('fuel_shift_credits')
export class FuelShiftCredit extends BaseEntity {
  @Column({ name: 'shift_id', type: 'uuid' })
  shiftId: string;

  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ ...money('liters') })
  liters: number;

  /** Amount receivable (VAT included) = the invoice total. */
  @Column({ ...money('amount') })
  amount: number;

  @Column({ name: 'sales_invoice_id', type: 'uuid', nullable: true })
  salesInvoiceId: string | null;

  @ManyToOne(() => FuelShift, (s) => s.credits, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shift_id' })
  shift: FuelShift;
}
