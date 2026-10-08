import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Propagation, runInTransaction } from 'typeorm-transactional';
import { createHash } from 'crypto';
import {
  ApprovalDocumentType,
  ApprovalRule,
  ApprovalRuleLevel,
} from '../entities/approval-rule.entity';
import {
  ApprovalAction,
  ApprovalActionType,
  ApprovalLevelSnapshot,
  ApprovalRequest,
  ApprovalRequestStatus,
} from '../entities/approval-request.entity';
import {
  ApprovalLevelDto,
  ApprovalRequestQueryDto,
  CreateApprovalRuleDto,
  UpdateApprovalRuleDto,
} from '../dto/approval.dto';
import { UserRole } from '@modules/auth/entities/user-role.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { inTransaction } from '@shared/services/transactional-events.service';
import { round } from '@shared/utils/document-totals.util';

/** The document an approval is asked for. */
export interface ApprovalSubject {
  documentType: ApprovalDocumentType;
  /** Existing document (bill, voucher, order). */
  documentId?: string;
  documentRef?: string;
  /** For documents created only after approval (payments): identifies the request payload. */
  fingerprint?: string;
  /** Base-currency amount compared with the rule thresholds. */
  amount: number;
  description?: string;
  payload?: Record<string, any>;
  /**
   * Table that holds `documentId`. When set, `ensureApproved` only records
   * the request if the document is already committed (a document created in
   * the same request is rolled back together with the 409).
   */
  documentTable?: 'purchase_invoices' | 'treasury_vouchers' | 'purchase_orders';
}

/** Callbacks a module registers to act when one of its requests is decided. */
export interface ApprovalHandler {
  /** Runs in the approver's transaction once the last level is approved. */
  onApproved?: (request: ApprovalRequest, userId: string) => Promise<unknown>;
  /** Runs when the request is rejected or cancelled. */
  onRejected?: (request: ApprovalRequest, userId: string, comment?: string) => Promise<unknown>;
}

/**
 * Thrown (HTTP 409) when a document needs an approval that has not been
 * given yet. The message carries the request number and id so the client can
 * show or follow it: "... [approvalRequestId=<uuid>]".
 */
export class ApprovalRequiredException extends ConflictException {
  constructor(readonly request: ApprovalRequest) {
    super({
      statusCode: 409,
      message: `Approval required: approval request ${request.requestNumber} is ${request.status} [approvalRequestId=${request.id}]`,
      approvalRequestId: request.id,
      requestNumber: request.requestNumber,
    });
  }
}

/** Stable hash of a request payload, used to recognise the same payment twice. */
export function fingerprintOf(value: Record<string, any>): string {
  const sorted = (v: any): any =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === 'object'
        ? Object.keys(v)
            .sort()
            .reduce((acc, k) => ((acc[k] = sorted(v[k])), acc), {} as Record<string, any>)
        : v;
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex').slice(0, 40);
}

/** Chooses the rule for an amount: highest threshold first, then priority. */
export function pickRule(rules: ApprovalRule[], amount: number): ApprovalRule | null {
  const value = round(Number(amount), 4);
  const matching = rules.filter(
    (r) =>
      r.isActive &&
      value > round(Number(r.minAmount || 0), 4) &&
      (r.maxAmount === null || r.maxAmount === undefined || value <= Number(r.maxAmount)),
  );
  matching.sort(
    (a, b) => Number(b.minAmount) - Number(a.minAmount) || Number(a.priority) - Number(b.priority),
  );
  return matching[0] ?? null;
}

/**
 * Generic multi-level approval engine (Odoo "approvals" / tiered validation).
 *
 * Rules per document type define amount bands and ordered levels (a role
 * and/or users, with a minimum number of distinct approvers). Modules call
 * `ensureApproved` before a guarded action; when a rule applies and no
 * approval exists yet a request is recorded and a 409 is thrown. When the
 * last level approves, the module's registered handler carries out the
 * action (post the bill, create the payment, confirm the order...).
 *
 * Users holding a system (superuser) role may act on any level, consistent
 * with the RBAC guard.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);
  private readonly handlers = new Map<ApprovalDocumentType, ApprovalHandler>();

  constructor(
    @InjectRepository(ApprovalRule)
    private readonly ruleRepo: Repository<ApprovalRule>,
    @InjectRepository(ApprovalRuleLevel)
    private readonly levelRepo: Repository<ApprovalRuleLevel>,
    @InjectRepository(ApprovalRequest)
    private readonly requestRepo: Repository<ApprovalRequest>,
    @InjectRepository(ApprovalAction)
    private readonly actionRepo: Repository<ApprovalAction>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly sequenceService: SequenceService,
  ) {}

  registerHandler(documentType: ApprovalDocumentType, handler: ApprovalHandler): void {
    this.handlers.set(documentType, handler);
  }

  // ---------------------------------------------------------------- rules

  findRules(tenantId: string, documentType?: ApprovalDocumentType): Promise<ApprovalRule[]> {
    const where: any = { tenantId };
    if (documentType) where.documentType = documentType;
    return this.ruleRepo.find({
      where,
      order: { documentType: 'ASC', minAmount: 'ASC', priority: 'ASC' },
    });
  }

  async findRule(tenantId: string, id: string): Promise<ApprovalRule> {
    const rule = await this.ruleRepo.findOne({ where: { id, tenantId } });
    if (!rule) throw new NotFoundException('Approval rule not found');
    rule.levels?.sort((a, b) => a.sequence - b.sequence);
    return rule;
  }

  async createRule(tenantId: string, dto: CreateApprovalRuleDto): Promise<ApprovalRule> {
    this.assertBand(dto.minAmount, dto.maxAmount);
    const rule = this.ruleRepo.create({
      tenantId,
      name: dto.name,
      documentType: dto.documentType,
      minAmount: round(dto.minAmount ?? 0, 4),
      maxAmount: dto.maxAmount ?? null,
      priority: dto.priority ?? 100,
      allowSelfApproval: dto.allowSelfApproval ?? false,
      isActive: dto.isActive ?? true,
      description: dto.description,
      levels: this.buildLevels(dto.levels),
    });
    const saved = await this.ruleRepo.save(rule);
    return this.findRule(tenantId, saved.id);
  }

  async updateRule(tenantId: string, id: string, dto: UpdateApprovalRuleDto): Promise<ApprovalRule> {
    const rule = await this.findRule(tenantId, id);
    const { levels, ...header } = dto;
    Object.assign(rule, header);
    this.assertBand(rule.minAmount, rule.maxAmount);
    if (levels) {
      await this.levelRepo.delete({ ruleId: rule.id });
      rule.levels = this.buildLevels(levels);
    }
    await this.ruleRepo.save(rule);
    return this.findRule(tenantId, id);
  }

  /** Rules are deactivated rather than deleted so past requests keep their reference. */
  async deactivateRule(tenantId: string, id: string): Promise<ApprovalRule> {
    const rule = await this.findRule(tenantId, id);
    rule.isActive = false;
    return this.ruleRepo.save(rule);
  }

  /** True when the tenant has at least one active rule for the document type. */
  async hasActiveRule(tenantId: string, documentType: ApprovalDocumentType): Promise<boolean> {
    return (await this.ruleRepo.count({ where: { tenantId, documentType, isActive: true } })) > 0;
  }

  async findApplicableRule(
    tenantId: string,
    documentType: ApprovalDocumentType,
    amount: number,
  ): Promise<ApprovalRule | null> {
    const rules = await this.ruleRepo.find({ where: { tenantId, documentType, isActive: true } });
    if (!rules.length) return null;
    return pickRule(rules, amount);
  }

  // ------------------------------------------------------------- requests

  /**
   * Guard used before a controlled action. Returns null when no rule
   * applies, the approved request when the action may proceed (marking it
   * executed), and otherwise throws ApprovalRequiredException with a pending
   * request that is committed independently of the failing HTTP request.
   */
  async ensureApproved(
    tenantId: string,
    userId: string,
    subject: ApprovalSubject,
  ): Promise<ApprovalRequest | null> {
    const rule = await this.findApplicableRule(tenantId, subject.documentType, subject.amount);
    if (!rule) return null;

    const existing = await this.findOpenRequest(tenantId, subject);
    if (existing?.status === ApprovalRequestStatus.APPROVED) {
      existing.executedAt = new Date();
      if (subject.documentId && !existing.documentId) existing.documentId = subject.documentId;
      return this.requestRepo.save(existing);
    }
    if (existing) throw new ApprovalRequiredException(existing);

    const created = await this.persistIndependently(async () => {
      if (subject.documentId && subject.documentTable) {
        const rows = await this.requestRepo.query(
          `SELECT 1 FROM "${subject.documentTable}" WHERE id = $1 AND tenant_id = $2`,
          [subject.documentId, tenantId],
        );
        if (!rows.length) return null;
      }
      return this.createRequest(tenantId, userId, subject, rule);
    });
    if (!created) {
      throw new ConflictException(
        'This document needs approval: save it as a draft first, then submit it again to request approval',
      );
    }
    throw new ApprovalRequiredException(created);
  }

  /**
   * Records a request inside the current transaction and returns it, reusing
   * an open one for the same document. Returns null when no rule applies.
   */
  async submit(
    tenantId: string,
    userId: string,
    subject: ApprovalSubject,
  ): Promise<ApprovalRequest | null> {
    const rule = await this.findApplicableRule(tenantId, subject.documentType, subject.amount);
    if (!rule) return null;
    const existing = await this.findOpenRequest(tenantId, subject);
    if (existing) return existing;
    return this.createRequest(tenantId, userId, subject, rule);
  }

  /** Latest pending, or approved but not yet executed, request for the document. */
  async findOpenRequest(
    tenantId: string,
    subject: Pick<ApprovalSubject, 'documentType' | 'documentId' | 'fingerprint'>,
  ): Promise<ApprovalRequest | null> {
    if (!subject.documentId && !subject.fingerprint) return null;
    const where: any = {
      tenantId,
      documentType: subject.documentType,
      status: In([ApprovalRequestStatus.PENDING, ApprovalRequestStatus.APPROVED]),
      executedAt: IsNull(),
    };
    if (subject.documentId) where.documentId = subject.documentId;
    else where.fingerprint = subject.fingerprint;
    return this.requestRepo.findOne({ where, order: { createdAt: 'DESC' } });
  }

  async markExecuted(request: ApprovalRequest, documentId?: string): Promise<ApprovalRequest> {
    request.executedAt = new Date();
    if (documentId) request.documentId = documentId;
    return this.requestRepo.save(request);
  }

  findAll(tenantId: string, query: ApprovalRequestQueryDto = {}): Promise<ApprovalRequest[]> {
    const where: any = { tenantId };
    if (query.documentType) where.documentType = query.documentType;
    if (query.documentId) where.documentId = query.documentId;
    if (query.status) where.status = query.status;
    if (query.requestedBy) where.requestedBy = query.requestedBy;
    return this.requestRepo.find({ where, order: { createdAt: 'DESC' }, take: 500 });
  }

  async findById(tenantId: string, id: string): Promise<ApprovalRequest> {
    const request = await this.requestRepo.findOne({
      where: { id, tenantId },
      relations: ['actions'],
    });
    if (!request) throw new NotFoundException('Approval request not found');
    request.actions?.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    return request;
  }

  /** Every request (and its actions) for one document, newest first. */
  async history(tenantId: string, documentType: ApprovalDocumentType, documentId: string) {
    const requests = await this.requestRepo.find({
      where: { tenantId, documentType, documentId },
      relations: ['actions'],
      order: { createdAt: 'DESC' },
    });
    requests.forEach((r) =>
      r.actions?.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
    );
    return requests;
  }

  /** Pending requests whose current level the user can approve and has not acted on yet. */
  async myPending(tenantId: string, userId: string): Promise<ApprovalRequest[]> {
    const pending = await this.requestRepo.find({
      where: { tenantId, status: ApprovalRequestStatus.PENDING },
      relations: ['actions'],
      order: { createdAt: 'ASC' },
    });
    if (!pending.length) return [];
    const roles = await this.userRoles(tenantId, userId);
    return pending.filter((r) => {
      const level = r.levels[r.currentLevel - 1];
      if (!level || !this.isEligible(level, userId, roles)) return false;
      if (!r.allowSelfApproval && r.requestedBy === userId) return false;
      return !r.actions?.some(
        (a) =>
          a.level === r.currentLevel &&
          a.userId === userId &&
          a.action === ApprovalActionType.APPROVE,
      );
    });
  }

  async approve(
    tenantId: string,
    userId: string,
    id: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.findPending(tenantId, id);
    const level = await this.assertCanDecide(tenantId, userId, request);

    if (
      request.actions.some(
        (a) =>
          a.level === request.currentLevel &&
          a.userId === userId &&
          a.action === ApprovalActionType.APPROVE,
      )
    ) {
      throw new ConflictException('You have already approved this level');
    }

    await this.addAction(request, userId, ApprovalActionType.APPROVE, comment);
    const approvers = new Set(
      request.actions
        .filter((a) => a.level === request.currentLevel && a.action === ApprovalActionType.APPROVE)
        .map((a) => a.userId),
    );
    if (approvers.size >= Number(level.minApprovers || 1)) {
      request.currentLevel += 1;
    }

    if (request.currentLevel > request.levels.length) {
      request.status = ApprovalRequestStatus.APPROVED;
      request.decidedBy = userId;
      request.decidedAt = new Date();
    }
    const saved = await this.requestRepo.save(request);

    if (saved.status === ApprovalRequestStatus.APPROVED) {
      const handler = this.handlers.get(saved.documentType);
      if (handler?.onApproved) await handler.onApproved(saved, userId);
    }
    return this.findById(tenantId, id);
  }

  async reject(
    tenantId: string,
    userId: string,
    id: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.findPending(tenantId, id);
    await this.assertCanDecide(tenantId, userId, request);
    if (!comment?.trim()) throw new BadRequestException('A rejection needs a comment');
    await this.addAction(request, userId, ApprovalActionType.REJECT, comment);
    request.status = ApprovalRequestStatus.REJECTED;
    request.decidedBy = userId;
    request.decidedAt = new Date();
    const saved = await this.requestRepo.save(request);
    const handler = this.handlers.get(saved.documentType);
    if (handler?.onRejected) await handler.onRejected(saved, userId, comment);
    return this.findById(tenantId, id);
  }

  /** The requester (or a superuser) withdraws a pending request. */
  async cancel(
    tenantId: string,
    userId: string,
    id: string,
    comment?: string,
  ): Promise<ApprovalRequest> {
    const request = await this.findPending(tenantId, id);
    if (request.requestedBy !== userId && !(await this.userRoles(tenantId, userId)).superuser) {
      throw new ForbiddenException('Only the requester can cancel this request');
    }
    await this.addAction(request, userId, ApprovalActionType.CANCEL, comment);
    request.status = ApprovalRequestStatus.CANCELLED;
    request.decidedBy = userId;
    request.decidedAt = new Date();
    const saved = await this.requestRepo.save(request);
    const handler = this.handlers.get(saved.documentType);
    if (handler?.onRejected) await handler.onRejected(saved, userId, comment);
    return this.findById(tenantId, id);
  }

  async comment(tenantId: string, userId: string, id: string, comment?: string) {
    if (!comment?.trim()) throw new BadRequestException('Comment is required');
    const request = await this.findById(tenantId, id);
    await this.addAction(request, userId, ApprovalActionType.COMMENT, comment);
    return this.findById(tenantId, id);
  }

  // -------------------------------------------------------------- helpers

  /**
   * Runs `fn` in its own transaction so its writes survive the rollback of
   * the HTTP request that is about to fail with a 409.
   */
  protected async persistIndependently<T>(fn: () => Promise<T>): Promise<T> {
    if (!inTransaction()) return fn();
    return runInTransaction(fn, { propagation: Propagation.REQUIRES_NEW });
  }

  private async createRequest(
    tenantId: string,
    userId: string,
    subject: ApprovalSubject,
    rule: ApprovalRule,
  ): Promise<ApprovalRequest> {
    const levels: ApprovalLevelSnapshot[] = [...(rule.levels ?? [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map((l) => ({
        sequence: l.sequence,
        name: l.name ?? null,
        roleId: l.roleId ?? null,
        userIds: l.userIds ?? [],
        minApprovers: Number(l.minApprovers || 1),
      }));
    if (!levels.length) throw new BadRequestException(`Approval rule ${rule.name} has no levels`);

    const requestNumber = await this.sequenceService.next(tenantId, 'approval_request', 'APR');
    const request = await this.requestRepo.save(
      this.requestRepo.create({
        tenantId,
        requestNumber,
        ruleId: rule.id,
        documentType: subject.documentType,
        documentId: subject.documentId ?? null,
        documentRef: subject.documentRef,
        fingerprint: subject.fingerprint ?? null,
        amount: round(subject.amount, 4),
        description: subject.description,
        payload: subject.payload ?? null,
        status: ApprovalRequestStatus.PENDING,
        levels,
        currentLevel: 1,
        allowSelfApproval: !!rule.allowSelfApproval,
        requestedBy: userId,
      }),
    );
    await this.actionRepo.save(
      this.actionRepo.create({
        requestId: request.id,
        tenantId,
        level: 0,
        userId,
        action: ApprovalActionType.SUBMIT,
        comment: subject.description,
      }),
    );
    return request;
  }

  private async findPending(tenantId: string, id: string): Promise<ApprovalRequest> {
    const request = await this.findById(tenantId, id);
    if (request.status !== ApprovalRequestStatus.PENDING) {
      throw new ConflictException(`Approval request ${request.requestNumber} is ${request.status}`);
    }
    request.actions = request.actions ?? [];
    return request;
  }

  private async assertCanDecide(
    tenantId: string,
    userId: string,
    request: ApprovalRequest,
  ): Promise<ApprovalLevelSnapshot> {
    const level = request.levels[request.currentLevel - 1];
    if (!level) throw new ConflictException('The request has no pending level');
    if (!request.allowSelfApproval && request.requestedBy === userId) {
      throw new ForbiddenException('You cannot approve or reject your own request');
    }
    const roles = await this.userRoles(tenantId, userId);
    if (!this.isEligible(level, userId, roles)) {
      throw new ForbiddenException(
        `You are not an approver of level ${level.sequence}${level.name ? ` (${level.name})` : ''}`,
      );
    }
    return level;
  }

  isEligible(
    level: ApprovalLevelSnapshot,
    userId: string,
    roles: { roleIds: Set<string>; superuser: boolean },
  ): boolean {
    if (roles.superuser) return true;
    if (level.userIds?.includes(userId)) return true;
    return !!level.roleId && roles.roleIds.has(level.roleId);
  }

  private async userRoles(
    tenantId: string,
    userId: string,
  ): Promise<{ roleIds: Set<string>; superuser: boolean }> {
    const now = new Date();
    const rows = await this.userRoleRepo.find({ where: { userId }, relations: ['role'] });
    const valid = rows.filter(
      (r) =>
        r.role &&
        r.role.tenantId === tenantId &&
        (!r.validFrom || new Date(r.validFrom) <= now) &&
        (!r.validTo || new Date(r.validTo) >= now),
    );
    return {
      roleIds: new Set(valid.map((r) => r.roleId)),
      superuser: valid.some((r) => r.role.isSystemRole),
    };
  }

  private async addAction(
    request: ApprovalRequest,
    userId: string,
    action: ApprovalActionType,
    comment?: string,
  ): Promise<void> {
    const saved = await this.actionRepo.save(
      this.actionRepo.create({
        requestId: request.id,
        tenantId: request.tenantId,
        level: request.currentLevel,
        userId,
        action,
        comment,
      }),
    );
    request.actions = [...(request.actions ?? []), saved];
  }

  private buildLevels(levels: ApprovalLevelDto[]): ApprovalRuleLevel[] {
    return levels.map((l, i) => {
      if (!l.roleId && !l.userIds?.length) {
        throw new BadRequestException(`Level ${i + 1} needs a role or at least one user`);
      }
      if (l.userIds?.length && !l.roleId && (l.minApprovers ?? 1) > l.userIds.length) {
        throw new BadRequestException(
          `Level ${i + 1} requires ${l.minApprovers} approvers but lists only ${l.userIds.length} users`,
        );
      }
      return this.levelRepo.create({
        sequence: l.sequence ?? i + 1,
        name: l.name,
        roleId: l.roleId ?? null,
        userIds: l.userIds ?? [],
        minApprovers: l.minApprovers ?? 1,
      });
    });
  }

  private assertBand(min?: number | null, max?: number | null): void {
    if (max !== null && max !== undefined && Number(max) < Number(min ?? 0)) {
      throw new BadRequestException('maxAmount cannot be lower than minAmount');
    }
  }
}
