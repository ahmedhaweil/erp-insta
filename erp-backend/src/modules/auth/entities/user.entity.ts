import { Entity, Column, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Exclude } from 'class-transformer';
import { UserRole } from './user-role.entity';

@Entity('users')
export class User extends TenantBaseEntity {
  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ name: 'password_hash' })
  @Exclude()
  passwordHash: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_login', type: 'timestamptz', nullable: true })
  lastLogin: Date;

  @Column({ name: 'failed_attempts', default: 0 })
  failedAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date;

  @Column({ name: 'two_fa_secret', nullable: true })
  @Exclude()
  twoFaSecret: string;

  @Column({ name: 'two_fa_enabled', default: false })
  twoFaEnabled: boolean;

  @Column({ name: 'reset_token', nullable: true })
  @Exclude()
  resetToken: string;

  @Column({ name: 'reset_token_expiry', type: 'timestamptz', nullable: true })
  resetTokenExpiry: Date;

  @OneToMany(() => UserRole, (userRole) => userRole.user)
  userRoles: UserRole[];
}
