import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { CrmStage } from './crm-stage.entity';

export enum LeadType {
  LEAD = 'lead',
  OPPORTUNITY = 'opportunity',
}

export enum LeadStatus {
  OPEN = 'open',
  WON = 'won',
  LOST = 'lost',
}

export enum LeadSource {
  WEBSITE = 'website',
  PHONE = 'phone',
  EMAIL = 'email',
  REFERRAL = 'referral',
  WALK_IN = 'walk_in',
  SOCIAL_MEDIA = 'social_media',
  CAMPAIGN = 'campaign',
  EXHIBITION = 'exhibition',
  OTHER = 'other',
}

/** Lead / opportunity (Odoo crm.lead / العملاء المحتملون والفرص). */
@Entity('crm_leads')
@Index(['tenantId', 'assignedUserId'])
export class CrmLead extends TenantBaseEntity {
  @Column({ name: 'lead_number' })
  leadNumber: string;

  @Column()
  title: string;

  @Column({ type: 'enum', enum: LeadType, default: LeadType.LEAD })
  type: LeadType;

  @Column({ type: 'enum', enum: LeadStatus, default: LeadStatus.OPEN })
  status: LeadStatus;

  @Column({ name: 'stage_id', type: 'uuid', nullable: true })
  stageId: string;

  /** Probability (%); defaults to the stage probability. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  probability: number;

  @Column({ name: 'expected_revenue', type: 'decimal', precision: 18, scale: 4, default: 0 })
  expectedRevenue: number;

  @Column({ name: 'currency_id', type: 'uuid', nullable: true })
  currencyId: string;

  @Column({ name: 'expected_close_date', type: 'date', nullable: true })
  expectedCloseDate: string;

  @Column({ type: 'enum', enum: LeadSource, default: LeadSource.OTHER })
  source: LeadSource;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string;

  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string;

  // Prospect contact information (when not yet a customer)
  @Column({ name: 'contact_name', nullable: true })
  contactName: string;

  @Column({ name: 'company_name', nullable: true })
  companyName: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  country: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ name: 'lost_reason', nullable: true })
  lostReason: string;

  @Column({ name: 'closed_date', type: 'date', nullable: true })
  closedDate: string;

  /** Quotation (draft sales order) created from the opportunity. */
  @Column({ name: 'sales_order_id', type: 'uuid', nullable: true })
  salesOrderId: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => CrmStage)
  @JoinColumn({ name: 'stage_id' })
  stage: CrmStage;

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;
}
