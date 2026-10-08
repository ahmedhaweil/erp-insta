import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  ApprovalRequiredException,
  ApprovalsService,
  fingerprintOf,
  pickRule,
} from './approvals.service';
import { ApprovalDocumentType, ApprovalRule } from '../entities/approval-rule.entity';
import { ApprovalRequest, ApprovalRequestStatus } from '../entities/approval-request.entity';

const rule = (over: Partial<ApprovalRule>): ApprovalRule =>
  ({
    id: 'r',
    name: 'rule',
    isActive: true,
    minAmount: 0,
    maxAmount: null,
    priority: 100,
    allowSelfApproval: false,
    documentType: ApprovalDocumentType.VENDOR_BILL,
    levels: [{ sequence: 1, roleId: 'role-fin', userIds: [], minApprovers: 1 }],
    ...over,
  }) as ApprovalRule;

describe('pickRule', () => {
  const rules = [
    rule({ id: 'small', minAmount: 1000, maxAmount: 10000 }),
    rule({ id: 'big', minAmount: 10000 }),
    rule({ id: 'off', minAmount: 0, isActive: false }),
  ];

  it('applies only strictly above the threshold', () => {
    expect(pickRule(rules, 1000)).toBeNull();
    expect(pickRule(rules, 1000.01)?.id).toBe('small');
  });

  it('prefers the highest matching threshold', () => {
    expect(pickRule(rules, 10000)?.id).toBe('small'); // max is inclusive
    expect(pickRule(rules, 50000)?.id).toBe('big');
  });
});

describe('fingerprintOf', () => {
  it('ignores key order', () => {
    expect(fingerprintOf({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprintOf({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprintOf({ a: 1 })).not.toBe(fingerprintOf({ a: 2 }));
  });
});

describe('ApprovalsService', () => {
  let service: ApprovalsService;
  let ruleRepo: any;
  let requestRepo: any;
  let actionRepo: any;
  let userRoleRepo: any;
  let sequence: any;

  beforeEach(() => {
    ruleRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn() };
    requestRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (r) => ({ id: r.id ?? 'req-1', ...r })),
      create: jest.fn((r) => r),
      query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    actionRepo = {
      save: jest.fn(async (a) => ({ ...a, createdAt: new Date() })),
      create: jest.fn((a) => a),
    };
    userRoleRepo = { find: jest.fn().mockResolvedValue([]) };
    sequence = { next: jest.fn().mockResolvedValue('APR-000001') };
    service = new ApprovalsService(ruleRepo, {} as any, requestRepo, actionRepo, userRoleRepo, sequence);
  });

  const subject = {
    documentType: ApprovalDocumentType.VENDOR_BILL,
    documentId: 'bill-1',
    documentTable: 'purchase_invoices' as const,
    amount: 5000,
  };

  it('does nothing when no rule applies', async () => {
    await expect(service.ensureApproved('t', 'u', subject)).resolves.toBeNull();
    expect(requestRepo.save).not.toHaveBeenCalled();
  });

  it('records a request outside the failing transaction and throws 409', async () => {
    ruleRepo.find.mockResolvedValue([rule({ minAmount: 1000 })]);
    const persist = jest
      .spyOn(service as any, 'persistIndependently')
      .mockImplementation(async (fn: any) => fn());

    await expect(service.ensureApproved('t', 'u', subject)).rejects.toBeInstanceOf(
      ApprovalRequiredException,
    );
    expect(persist).toHaveBeenCalled();
    expect(requestRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'bill-1',
        status: ApprovalRequestStatus.PENDING,
        levels: [expect.objectContaining({ roleId: 'role-fin', minApprovers: 1 })],
      }),
    );
  });

  it('refuses to record a request for a document that is not committed yet', async () => {
    ruleRepo.find.mockResolvedValue([rule({ minAmount: 1000 })]);
    jest.spyOn(service as any, 'persistIndependently').mockImplementation(async (fn: any) => fn());
    requestRepo.query.mockResolvedValue([]);
    const err = await service.ensureApproved('t', 'u', subject).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err).not.toBeInstanceOf(ApprovalRequiredException);
    expect(requestRepo.save).not.toHaveBeenCalled();
  });

  it('re-throws the pending request instead of creating another', async () => {
    ruleRepo.find.mockResolvedValue([rule({ minAmount: 1000 })]);
    requestRepo.findOne.mockResolvedValue({ id: 'old', requestNumber: 'APR-9', status: 'pending' });
    const err = await service.ensureApproved('t', 'u', subject).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalRequiredException);
    expect(err.message).toContain('approvalRequestId=old');
    expect(requestRepo.create).not.toHaveBeenCalled();
  });

  it('lets an approved request through once and marks it executed', async () => {
    ruleRepo.find.mockResolvedValue([rule({ minAmount: 1000 })]);
    requestRepo.findOne.mockResolvedValue({ id: 'ok', status: 'approved', executedAt: null });
    const result = await service.ensureApproved('t', 'u', subject);
    expect(result?.executedAt).toBeInstanceOf(Date);
  });

  describe('approve', () => {
    const pending = (): ApprovalRequest =>
      ({
        id: 'req',
        tenantId: 't',
        requestNumber: 'APR-1',
        documentType: ApprovalDocumentType.VENDOR_BILL,
        documentId: 'bill-1',
        status: ApprovalRequestStatus.PENDING,
        requestedBy: 'clerk',
        allowSelfApproval: false,
        currentLevel: 1,
        levels: [
          { sequence: 1, roleId: 'role-fin', userIds: [], minApprovers: 2 },
          { sequence: 2, roleId: null, userIds: ['cfo'], minApprovers: 1 },
        ],
        actions: [],
      }) as any;

    let current: ApprovalRequest;
    beforeEach(() => {
      current = pending();
      requestRepo.findOne.mockImplementation(async () => current);
      requestRepo.save.mockImplementation(async (r: any) => (current = r));
      userRoleRepo.find.mockImplementation(async ({ where }: any) =>
        ['a1', 'a2'].includes(where.userId)
          ? [{ userId: where.userId, roleId: 'role-fin', role: { tenantId: 't', isSystemRole: false } }]
          : [],
      );
    });

    it('needs the minimum distinct approvers per level, in order, then runs the handler', async () => {
      const onApproved = jest.fn();
      service.registerHandler(ApprovalDocumentType.VENDOR_BILL, { onApproved });

      await service.approve('t', 'a1', 'req');
      expect(current.currentLevel).toBe(1);
      await expect(service.approve('t', 'a1', 'req')).rejects.toBeInstanceOf(ConflictException);
      await expect(service.approve('t', 'cfo', 'req')).rejects.toBeInstanceOf(ForbiddenException);
      await service.approve('t', 'a2', 'req');
      expect(current.currentLevel).toBe(2);
      expect(onApproved).not.toHaveBeenCalled();

      await service.approve('t', 'cfo', 'req');
      expect(current.status).toBe(ApprovalRequestStatus.APPROVED);
      expect(onApproved).toHaveBeenCalledWith(expect.objectContaining({ id: 'req' }), 'cfo');
    });

    it('forbids approving your own request', async () => {
      current.levels[0].userIds = ['clerk'];
      await expect(service.approve('t', 'clerk', 'req')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects with a comment and notifies the handler', async () => {
      const onRejected = jest.fn();
      service.registerHandler(ApprovalDocumentType.VENDOR_BILL, { onRejected });
      await service.reject('t', 'a1', 'req', 'too expensive');
      expect(current.status).toBe(ApprovalRequestStatus.REJECTED);
      expect(onRejected).toHaveBeenCalledWith(expect.anything(), 'a1', 'too expensive');
    });

    it('lets superusers act on any level', async () => {
      userRoleRepo.find.mockResolvedValue([
        { userId: 'admin', roleId: 'sys', role: { tenantId: 't', isSystemRole: true } },
      ]);
      await service.approve('t', 'admin', 'req');
      expect(current.actions).toHaveLength(1);
    });
  });
});
