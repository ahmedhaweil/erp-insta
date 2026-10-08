import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum EInvoiceType {
  SALES = 'sales',
  PURCHASE = 'purchase',
}

/**
 * Unified lifecycle of an electronic document.
 *  ETA:   pending -> submitted -> valid | invalid ; valid -> cancelled | rejected
 *  ZATCA: pending -> reported (simplified) | cleared (standard) | invalid
 *  failed = transport/authentication error, safe to retry unchanged.
 */
export enum EInvoiceStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  VALID = 'valid',
  INVALID = 'invalid',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
  REPORTED = 'reported',
  CLEARED = 'cleared',
  FAILED = 'failed',
}

export enum EInvoiceProvider {
  ETA = 'eta',
  ZATCA = 'zatca',
}

export interface ComplianceMessage {
  code?: string;
  message: string;
  target?: string;
  path?: string;
  category?: string;
  severity?: 'error' | 'warning' | 'info';
}

@Entity('e_invoices')
@Index(['tenantId', 'provider', 'invoiceId'], { unique: true })
export class EInvoice extends TenantBaseEntity {
  /** Source sales invoice / credit note id. */
  @Column({ name: 'invoice_id', type: 'uuid' })
  invoiceId: string;

  @Column({ name: 'invoice_type', type: 'enum', enum: EInvoiceType, default: EInvoiceType.SALES })
  invoiceType: EInvoiceType;

  @Column({ type: 'enum', enum: EInvoiceProvider })
  provider: EInvoiceProvider;

  /** ETA documentType (I/C/D) or ZATCA invoice type code (388/381/383). */
  @Column({ name: 'document_type', nullable: true })
  documentType: string;

  /** ZATCA subtype: standard (0100000) or simplified (0200000). */
  @Column({ name: 'document_subtype', nullable: true })
  documentSubtype: string;

  /** Our document number (ETA internalID / ZATCA cbc:ID). */
  @Column({ name: 'internal_id', nullable: true })
  internalId: string;

  @Column({ name: 'document_date', type: 'date', nullable: true })
  documentDate: string;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 5, default: 0 })
  totalAmount: number;

  @Column({ type: 'enum', enum: EInvoiceStatus, default: EInvoiceStatus.PENDING })
  status: EInvoiceStatus;

  /** ETA submission UUID. */
  @Column({ name: 'submission_uuid', nullable: true })
  submissionUuid: string;

  /** ETA document UUID / ZATCA invoice UUID. */
  @Column({ nullable: true })
  @Index()
  uuid: string;

  @Column({ name: 'long_id', nullable: true })
  longId: string;

  /** ETA hashKey / ZATCA invoice hash (base64 SHA-256). */
  @Column({ name: 'invoice_hash', type: 'text', nullable: true })
  invoiceHash: string;

  /** ZATCA previous invoice hash used for this document. */
  @Column({ name: 'previous_hash', type: 'text', nullable: true })
  previousHash: string;

  /** ZATCA invoice counter value (ICV). */
  @Column({ type: 'int', nullable: true })
  icv: number;

  /** The ETA document JSON that was submitted (signatures included). */
  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, any>;

  /** ZATCA signed UBL XML (or the cleared XML returned by ZATCA). */
  @Column({ type: 'text', nullable: true })
  xml: string;

  /** QR content (ZATCA TLV base64) or the ETA public print URL. */
  @Column({ name: 'qr_content', type: 'text', nullable: true })
  qrContent: string;

  @Column({ name: 'validation_errors', type: 'jsonb', nullable: true })
  validationErrors: ComplianceMessage[];

  @Column({ type: 'jsonb', nullable: true })
  warnings: ComplianceMessage[];

  /** Last raw response from the tax authority. */
  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, any>;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date;

  @Column({ name: 'validated_at', type: 'timestamptz', nullable: true })
  validatedAt: Date;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt: Date;

  @Column({ name: 'cancel_reason', nullable: true })
  cancelReason: string;

  @Column({ name: 'submitted_by', type: 'uuid', nullable: true })
  submittedBy: string;
}
