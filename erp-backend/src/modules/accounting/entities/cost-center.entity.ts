import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('cost_centers')
export class CostCenter extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  @ManyToOne(() => CostCenter, (cc) => cc.children, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: CostCenter;

  @OneToMany(() => CostCenter, (cc) => cc.parent)
  children: CostCenter[];
}
