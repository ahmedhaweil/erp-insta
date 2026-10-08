import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Sales representative. */
@Entity('sales_reps')
export class SalesRep extends TenantBaseEntity {
  @Column()
  code: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  /** Optional link to a system user. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  /** Optional link to an HR employee record. */
  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
