import { Column, Entity } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import type { ChequeFieldKey, ChequeFieldPosition } from '../templates/cheque-renderer';

/**
 * Field positions used to print issued cheques on a bank's pre-printed
 * cheque book. A layout is chosen by id, else by the cheque's bank account
 * (treasury), else by bank name, else the tenant default.
 */
@Entity('print_cheque_layouts')
export class ChequePrintLayout extends TenantBaseEntity {
  @Column()
  name: string;

  /** Matched (case-insensitively) against the cheque / treasury bank name. */
  @Column({ name: 'bank_name', nullable: true })
  bankName: string | null;

  /** Bank account (treasury) whose cheque book uses this layout. */
  @Column({ name: 'treasury_id', type: 'uuid', nullable: true })
  treasuryId: string | null;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @Column({ name: 'width_mm', type: 'decimal', precision: 8, scale: 2, default: 175 })
  widthMm: number;

  @Column({ name: 'height_mm', type: 'decimal', precision: 8, scale: 2, default: 80 })
  heightMm: number;

  /** rtl (Arabic) or ltr. */
  @Column({ default: 'rtl' })
  direction: string;

  /** Language of the amount in words (ar | en). */
  @Column({ default: 'ar' })
  lang: string;

  @Column({ name: 'date_format', default: 'DD/MM/YYYY' })
  dateFormat: string;

  /** Characters printed around the numeric amount (e.g. "#"). */
  @Column({ name: 'amount_frame', default: '#' })
  amountFrame: string;

  /** Printer calibration shift in millimetres. */
  @Column({ name: 'offset_x', type: 'decimal', precision: 8, scale: 2, default: 0 })
  offsetX: number;

  @Column({ name: 'offset_y', type: 'decimal', precision: 8, scale: 2, default: 0 })
  offsetY: number;

  /** Field positions in millimetres from the top-left corner of the cheque. */
  @Column({ type: 'jsonb', default: {} })
  fields: Partial<Record<ChequeFieldKey, ChequeFieldPosition>>;
}
