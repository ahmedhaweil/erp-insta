import { Entity, Column, Index, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';

export enum EosProvisionStatus {
  POSTED = 'posted',
  REVERSED = 'reversed',
}

/**
 * Monthly end-of-service (gratuity) provision: per employee, the liability
 * at the period end less the provision already booked is posted
 * Dr EOS expense / Cr EOS provision (negative differences are released).
 */
@Entity('hr_eos_provisions')
export class EosProvision extends TenantBaseEntity {
  /** YYYY-MM */
  @Index()
  @Column()
  period: string;

  @Column({ name: 'posting_date', type: 'date' })
  postingDate: string;

  @Column({ type: 'enum', enum: EosProvisionStatus, default: EosProvisionStatus.POSTED })
  status: EosProvisionStatus;

  @Column({ name: 'employee_count', type: 'int', default: 0 })
  employeeCount: number;

  @Column({ name: 'total_liability', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalLiability: number;

  /** Net amount posted (sum of the employee deltas). */
  @Column({ name: 'total_delta', type: 'decimal', precision: 18, scale: 4, default: 0 })
  totalDelta: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @OneToMany(() => EosProvisionLine, (l) => l.provision, { cascade: true })
  lines: EosProvisionLine[];
}

@Entity('hr_eos_provision_lines')
export class EosProvisionLine extends BaseEntity {
  @Index()
  @Column({ name: 'provision_id', type: 'uuid' })
  provisionId: string;

  @ManyToOne(() => EosProvision, (p) => p.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provision_id' })
  provision: EosProvision;

  @Index()
  @Column({ name: 'employee_id', type: 'uuid' })
  employeeId: string;

  @Column({ name: 'employee_code' })
  employeeCode: string;

  @Column({ name: 'service_years', type: 'decimal', precision: 8, scale: 4, default: 0 })
  serviceYears: number;

  @Column({ name: 'monthly_wage', type: 'decimal', precision: 18, scale: 4, default: 0 })
  monthlyWage: number;

  /** Gratuity liability at the period end. */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  liability: number;

  /** Provision booked before this posting. */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  booked: number;

  /** liability - booked (posted amount; negative = release). */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  delta: number;

  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId: string | null;

  @Column({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId: string | null;
}
