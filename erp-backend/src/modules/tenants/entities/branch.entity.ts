import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Tenant } from './tenant.entity';

@Entity('branches')
export class Branch extends TenantBaseEntity {
  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @ManyToOne(() => Tenant, (tenant) => tenant.branches)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}
