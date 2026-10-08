import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { ComplianceMessage, EInvoiceStatus } from './e-invoice.entity';

/** ETA e-receipt (B2C) generated from a POS order. */
@Entity('e_receipts')
@Index(['tenantId', 'posOrderId'], { unique: true })
export class EReceipt extends TenantBaseEntity {
  @Column({ name: 'pos_order_id', type: 'uuid' })
  posOrderId: string;

  @Column({ name: 'receipt_number' })
  receiptNumber: string;

  /** S = sale, R = return. */
  @Column({ name: 'receipt_type', default: 'S' })
  receiptType: string;

  @Column({ name: 'device_serial' })
  deviceSerial: string;

  @Column()
  @Index()
  uuid: string;

  @Column({ name: 'previous_uuid', nullable: true })
  previousUuid: string;

  /** On a return: the uuid of the original sale receipt. */
  @Column({ name: 'reference_uuid', nullable: true })
  referenceUuid: string;

  @Column({ name: 'date_time_issued' })
  dateTimeIssued: string;

  @Column({ name: 'total_amount', type: 'decimal', precision: 18, scale: 5, default: 0 })
  totalAmount: number;

  @Column({ type: 'enum', enum: EInvoiceStatus, default: EInvoiceStatus.PENDING })
  status: EInvoiceStatus;

  @Column({ name: 'submission_uuid', nullable: true })
  submissionUuid: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ name: 'qr_content', type: 'text', nullable: true })
  qrContent: string;

  @Column({ name: 'validation_errors', type: 'jsonb', nullable: true })
  validationErrors: ComplianceMessage[];

  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, any>;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date;
}
