import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** Per-tenant purchasing configuration (one row per tenant). */
@Entity('purchasing_settings')
@Index('UQ_purchasing_settings_tenant', ['tenantId'], { unique: true })
export class PurchasingSettings extends TenantBaseEntity {
  /**
   * Purchase orders whose total (in base currency) exceeds this amount need
   * the approval of a user holding purchasing/po_approval/approve before
   * confirmation. 0 disables the approval step.
   */
  @Column({ name: 'po_approval_threshold', type: 'decimal', precision: 18, scale: 4, default: 0 })
  poApprovalThreshold: number;

  /** Purchase requisitions must be approved before conversion to RFQs. */
  @Column({ name: 'requisition_approval_required', default: true })
  requisitionApprovalRequired: boolean;
}
