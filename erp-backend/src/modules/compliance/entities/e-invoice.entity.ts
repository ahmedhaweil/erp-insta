import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum EInvoiceType {
  SALES = 'sales',
  PURCHASE = 'purchase',
}

export enum EInvoiceStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

export enum EInvoiceProvider {
  ETA = 'eta',
  ZATCA = 'zatca',
}

@Entity('e_invoices')
export class EInvoice extends TenantBaseEntity {
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'invoice_type', type: 'enum', enum: EInvoiceType })
  invoiceType: EInvoiceType;

  @Column({ name: 'external_id', nullable: true })
  externalId: string;

  @Column({ type: 'enum', enum: EInvoiceStatus, default: EInvoiceStatus.PENDING })
  status: EInvoiceStatus;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, any>;

  @Column({ type: 'enum', enum: EInvoiceProvider })
  provider: EInvoiceProvider;
}
