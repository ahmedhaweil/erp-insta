import { Entity, Column, Unique } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('hr_departments')
@Unique(['tenantId', 'code'])
export class Department extends TenantBaseEntity {
  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ name: 'name_ar', nullable: true })
  nameAr: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  /** Department head (employee id). */
  @Column({ name: 'manager_id', type: 'uuid', nullable: true })
  managerId: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
