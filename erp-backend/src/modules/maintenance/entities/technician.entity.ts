import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Repair technician (Instasoft "engreing" screen). */
@Entity('maintenance_technicians')
export class Technician extends TenantBaseEntity {
  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ nullable: true })
  phone: string;

  /** Optional link to the HR employee record. */
  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId: string | null;

  /** Optional link to the system user (e.g. to show "my tickets"). */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
