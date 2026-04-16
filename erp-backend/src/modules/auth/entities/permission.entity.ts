import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { RolePermission } from './role-permission.entity';

@Entity('permissions')
export class Permission extends BaseEntity {
  @Column()
  module: string;

  @Column({ nullable: true })
  screen: string;

  @Column({ nullable: true })
  action: string;

  @Column({ nullable: true })
  field: string;

  @Column({ nullable: true })
  description: string;

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  rolePermissions: RolePermission[];
}
