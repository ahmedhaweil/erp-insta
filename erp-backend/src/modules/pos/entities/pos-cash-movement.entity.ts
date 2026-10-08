import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/**
 * Cash put into or taken out of the drawer during a session that is not a
 * sale (float top-up, petty expense, transfer to the safe). Counts towards
 * the expected cash at closing.
 */
@Entity('pos_cash_movements')
export class PosCashMovement extends TenantBaseEntity {
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @Column()
  type: 'in' | 'out';

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  amount: number;

  @Column()
  reason: string;

  @Column({ name: 'account_id', type: 'uuid', nullable: true })
  accountId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;
}
