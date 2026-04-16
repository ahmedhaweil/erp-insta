import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

@Entity('accounts')
export class Account extends TenantBaseEntity {
  @Column()
  code: string;

  @Column({ name: 'name_ar' })
  nameAr: string;

  @Column({ name: 'name_en', nullable: true })
  nameEn: string;

  @Column({ type: 'enum', enum: AccountType })
  type: AccountType;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'allow_posting', default: true })
  allowPosting: boolean;

  @Column({ nullable: true })
  description: string;

  @Column({ default: 0 })
  level: number;

  @ManyToOne(() => Account, (account) => account.children, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Account;

  @OneToMany(() => Account, (account) => account.parent)
  children: Account[];
}
