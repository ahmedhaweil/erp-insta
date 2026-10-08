import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { BaseEntity } from '@shared/entities/base.entity';
import { ApprovalDocumentType } from './approval-rule.entity';

export enum ApprovalRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CANCELLED = 'cancelled',
}

export enum ApprovalActionType {
  SUBMIT = 'submit',
  APPROVE = 'approve',
  REJECT = 'reject',
  CANCEL = 'cancel',
  COMMENT = 'comment',
}

/** Level definition copied from the rule when the request is created. */
export interface ApprovalLevelSnapshot {
  sequence: number;
  name?: string | null;
  roleId: string | null;
  userIds: string[];
  minApprovers: number;
}

/**
 * A document waiting for (or having gone through) approval. Levels are
 * snapshotted so editing a rule does not change requests in flight.
 */
@Entity('approval_requests')
@Index(['tenantId', 'documentType', 'documentId'])
@Index(['tenantId', 'status'])
export class ApprovalRequest extends TenantBaseEntity {
  @Column({ name: 'request_number' })
  requestNumber: string;

  @Column({ name: 'rule_id', type: 'uuid' })
  ruleId: string;

  @Column({ name: 'document_type', type: 'enum', enum: ApprovalDocumentType })
  documentType: ApprovalDocumentType;

  /** Id of the document; set later for documents created on approval (payments). */
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  /** Human readable reference (bill number, payee...). */
  @Column({ name: 'document_ref', nullable: true })
  documentRef: string;

  /** Identifies a document that does not exist yet (hash of the request payload). */
  @Column({ nullable: true })
  fingerprint: string | null;

  /** Amount in base currency used for rule matching. */
  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  amount: number;

  @Column({ nullable: true })
  description: string;

  /** Data needed to execute the action on approval (e.g. the payment DTO). */
  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, any> | null;

  @Column({ type: 'enum', enum: ApprovalRequestStatus, default: ApprovalRequestStatus.PENDING })
  status: ApprovalRequestStatus;

  @Column({ type: 'jsonb' })
  levels: ApprovalLevelSnapshot[];

  /** 1-based level waiting for decisions (levels.length + 1 once approved). */
  @Column({ name: 'current_level', default: 1 })
  currentLevel: number;

  @Column({ name: 'allow_self_approval', default: false })
  allowSelfApproval: boolean;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy: string;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  /** Set when the approved action has been carried out (payment created, bill posted...). */
  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt: Date | null;

  @OneToMany(() => ApprovalAction, (a) => a.request, { cascade: true })
  actions: ApprovalAction[];
}

/** History of a request: submission, approvals, rejection, comments. */
@Entity('approval_actions')
export class ApprovalAction extends BaseEntity {
  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ nullable: true })
  level: number;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: ApprovalActionType })
  action: ApprovalActionType;

  @Column({ nullable: true })
  comment: string;

  @ManyToOne(() => ApprovalRequest, (r) => r.actions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: ApprovalRequest;
}
