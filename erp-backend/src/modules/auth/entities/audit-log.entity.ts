import { Entity, Column, CreateDateColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('audit_logs')
export class AuditLog extends TenantBaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column()
  action: string;

  @Column()
  module: string;

  @Column({ name: 'record_type' })
  recordType: string;

  @Column({ name: 'record_id', type: 'uuid', nullable: true })
  recordId: string;

  @Column({ name: 'old_value', type: 'jsonb', nullable: true })
  oldValue: Record<string, any>;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue: Record<string, any>;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress: string;

  @Column({ name: 'user_agent', nullable: true })
  userAgent: string;
}
