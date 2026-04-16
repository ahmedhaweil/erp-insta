import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('pos_sessions')
export class PosSession extends TenantBaseEntity {
  @Column({ name: 'terminal_id', type: 'uuid' })
  terminalId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'opened_at', type: 'timestamptz' })
  openedAt: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date;

  @Column({ name: 'opening_cash', type: 'decimal', precision: 18, scale: 4, default: 0 })
  openingCash: number;

  @Column({ name: 'closing_cash', type: 'decimal', precision: 18, scale: 4, nullable: true })
  closingCash: number;

  @Column({ default: 'open' })
  status: 'open' | 'closed';
}
