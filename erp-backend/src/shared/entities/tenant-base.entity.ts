import { Column, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

export abstract class TenantBaseEntity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index()
  tenantId: string;
}
