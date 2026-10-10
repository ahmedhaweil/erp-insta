import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Measured tank level compared with the book stock. */
@Entity('fuel_tank_dips')
export class FuelTankDip extends TenantBaseEntity {
  @Column({ name: 'tank_id', type: 'uuid' })
  tankId: string;

  @Column({ name: 'dipped_at', type: 'timestamptz' })
  dippedAt: Date;

  @Column({ name: 'measured_qty', type: 'decimal', precision: 18, scale: 4 })
  measuredQty: number;

  @Column({ name: 'book_qty', type: 'decimal', precision: 18, scale: 4 })
  bookQty: number;

  /** Measured minus book (negative = loss). */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  variance: number;

  /** The variance was booked as a stock adjustment. */
  @Column({ default: false })
  adjusted: boolean;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
}

/** Audited manual change of a nozzle meter (Instasoft edited it silently). */
@Entity('fuel_meter_adjustments')
export class FuelMeterAdjustment extends TenantBaseEntity {
  @Column({ name: 'nozzle_id', type: 'uuid' })
  nozzleId: string;

  @Column({ name: 'old_reading', type: 'decimal', precision: 18, scale: 4 })
  oldReading: number;

  @Column({ name: 'new_reading', type: 'decimal', precision: 18, scale: 4 })
  newReading: number;

  @Column({ type: 'text' })
  reason: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;
}
