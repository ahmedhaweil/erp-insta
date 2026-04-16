import { Entity, Column, OneToMany } from 'typeorm';
import { BaseEntity } from '@shared/entities/base.entity';
import { Branch } from './branch.entity';

@Entity('tenants')
export class Tenant extends BaseEntity {
  @Column({ unique: true })
  slug: string;

  @Column()
  name: string;

  @Column({ default: 'starter' })
  plan: string;

  @Column({ nullable: true })
  domain: string;

  @Column({ type: 'jsonb', default: {} })
  settings: Record<string, any>;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ nullable: true })
  country: string;

  @Column({ name: 'tax_id', nullable: true })
  taxId: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  address: string;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  @OneToMany(() => Branch, (branch) => branch.tenant)
  branches: Branch[];
}
