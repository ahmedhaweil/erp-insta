import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum TicketNumberReset {
  GLOBAL = 'global',
  DAILY = 'daily',
  SESSION = 'session',
}

@Entity('restaurant_settings')
@Index(['tenantId'], { unique: true })
export class RestaurantSettings extends TenantBaseEntity {
  /** Service charge % on dine-in tickets only. */
  @Column({ name: 'service_charge_percent', type: 'decimal', precision: 7, scale: 4, default: 0 })
  serviceChargePercent: number;

  /** Service-type product carrying the service charge on the sale. */
  @Column({ name: 'service_charge_product_id', type: 'uuid', nullable: true })
  serviceChargeProductId: string | null;

  /** Service-type product carrying the delivery fee on the sale. */
  @Column({ name: 'delivery_fee_product_id', type: 'uuid', nullable: true })
  deliveryFeeProductId: string | null;

  @Column({ name: 'require_table_for_dine_in', default: true })
  requireTableForDineIn: boolean;

  /** KDS colour thresholds (minutes): green below yellow, then yellow, orange, red. */
  @Column({ name: 'kds_yellow_minutes', type: 'int', default: 5 })
  kdsYellowMinutes: number;

  @Column({ name: 'kds_orange_minutes', type: 'int', default: 10 })
  kdsOrangeMinutes: number;

  @Column({ name: 'kds_red_minutes', type: 'int', default: 15 })
  kdsRedMinutes: number;

  @Column({
    name: 'ticket_number_reset',
    type: 'enum',
    enum: TicketNumberReset,
    default: TicketNumberReset.DAILY,
  })
  ticketNumberReset: TicketNumberReset;
}
