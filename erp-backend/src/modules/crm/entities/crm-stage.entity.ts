import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Configurable pipeline stage per tenant (Odoo crm.stage / مراحل الفرص). */
@Entity('crm_stages')
export class CrmStage extends TenantBaseEntity {
  @Column()
  name: string;

  @Column({ name: 'name_ar', nullable: true })
  nameAr: string;

  @Column({ type: 'int', default: 0 })
  sequence: number;

  /** Default probability (%) of leads entering this stage. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  probability: number;

  /** Leads moved here are marked won. */
  @Column({ name: 'is_won', default: false })
  isWon: boolean;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
