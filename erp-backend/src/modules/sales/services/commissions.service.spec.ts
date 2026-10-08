import { ConflictException } from '@nestjs/common';
import { CommissionsService, CommissionBaseItem } from './commissions.service';
import { CommissionBasis, CommissionRule } from '../entities/commission-rule.entity';
import { CommissionStatementStatus } from '../entities/commission-statement.entity';

const rule = (r: Partial<CommissionRule>): CommissionRule =>
  ({
    id: r.id ?? 'r',
    name: 'r',
    salesRepId: null,
    productCategoryId: null,
    basis: CommissionBasis.COLLECTED,
    rate: 1,
    targetAmount: 0,
    isActive: true,
    ...r,
  }) as CommissionRule;

describe('CommissionsService', () => {
  describe('pickRule', () => {
    const rules = [
      rule({ id: 'global', rate: 1 }),
      rule({ id: 'rep', salesRepId: 'rep1', rate: 2 }),
      rule({ id: 'rep-tier', salesRepId: 'rep1', rate: 4, targetAmount: 10000 }),
      rule({ id: 'cat', productCategoryId: 'cat1', rate: 3 }),
      rule({ id: 'rep-cat', salesRepId: 'rep1', productCategoryId: 'cat2', rate: 6 }),
      rule({ id: 'invoiced', basis: CommissionBasis.INVOICED, rate: 9 }),
    ];

    it('uses the most specific scope', () => {
      const pick = (rep: string, cat: string | null, total = 0) =>
        CommissionsService.pickRule(rules, rep, cat, CommissionBasis.COLLECTED, total)?.id;
      expect(pick('rep1', 'cat2')).toBe('rep-cat');
      expect(pick('rep1', 'cat1')).toBe('cat');
      expect(pick('rep1', null)).toBe('rep');
      expect(pick('rep2', null)).toBe('global');
    });

    it('applies the highest target tier reached', () => {
      expect(
        CommissionsService.pickRule(rules, 'rep1', null, CommissionBasis.COLLECTED, 12000)?.id,
      ).toBe('rep-tier');
    });

    it('filters by basis', () => {
      expect(
        CommissionsService.pickRule(rules, 'rep2', null, CommissionBasis.INVOICED, 0)?.id,
      ).toBe('invoiced');
    });
  });

  it('computes commission lines grouped by invoice and category', () => {
    const items: CommissionBaseItem[] = [
      { invoiceId: 'i1', invoiceNumber: 'INV-1', productCategoryId: 'cat1', basis: CommissionBasis.COLLECTED, amount: 600 },
      { invoiceId: 'i1', invoiceNumber: 'INV-1', productCategoryId: 'cat1', basis: CommissionBasis.COLLECTED, amount: 400 },
      { invoiceId: 'i1', invoiceNumber: 'INV-1', productCategoryId: null, basis: CommissionBasis.COLLECTED, amount: 500 },
    ];
    const result = CommissionsService.computeFromItems(
      [rule({ id: 'g', rate: 2 }), rule({ id: 'c', productCategoryId: 'cat1', rate: 5 })],
      'rep1',
      items,
    );
    expect(result.collected).toBe(1500);
    expect(result.commission).toBe(60); // 1000 x 5% + 500 x 2%
    expect(result.lines).toHaveLength(2);
  });

  describe('statements', () => {
    let service: CommissionsService;
    let statementRepo: Record<string, jest.Mock>;
    let autoPosting: Record<string, jest.Mock>;

    beforeEach(() => {
      statementRepo = {
        findOne: jest.fn(),
        save: jest.fn((x) => x),
        create: jest.fn((x) => x),
      };
      autoPosting = { preflight: jest.fn(), post: jest.fn(), reverseSource: jest.fn() };
      service = new CommissionsService(
        { findOne: jest.fn().mockResolvedValue({ id: 'rep1', name: 'Rep' }) } as any,
        { find: jest.fn().mockResolvedValue([]) } as any,
        statementRepo as any,
        {} as any,
        {} as any,
        autoPosting as any,
        { next: jest.fn().mockResolvedValue('COMM-1') } as any,
      );
    });

    it('accrues the commission: Dr commission expense / Cr commission payable', async () => {
      statementRepo.findOne.mockResolvedValue({
        id: 's1',
        statementNumber: 'COMM-1',
        salesRepId: 'rep1',
        periodFrom: '2026-01-01',
        periodTo: '2026-01-31',
        commissionAmount: 250,
        status: CommissionStatementStatus.DRAFT,
      });

      const result = await service.postStatement('t1', 'u1', 's1');

      const request = autoPosting.post.mock.calls[0][0];
      expect(request.date).toBe('2026-01-31');
      expect(request.buildLines({}, (k: string) => k)).toEqual([
        { accountId: 'commissionExpenseAccountId', debit: 250 },
        { accountId: 'commissionPayableAccountId', credit: 250 },
      ]);
      expect(result.status).toBe(CommissionStatementStatus.POSTED);
    });

    it('refuses overlapping statements for the same rep', async () => {
      statementRepo.findOne.mockResolvedValue({ statementNumber: 'COMM-0' });
      await expect(
        service.createStatement('t1', 'u1', {
          salesRepId: 'rep1',
          periodFrom: '2026-01-01',
          periodTo: '2026-01-31',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('reverses the accrual when a posted statement is cancelled', async () => {
      statementRepo.findOne.mockResolvedValue({ id: 's1', status: CommissionStatementStatus.POSTED });
      await service.cancelStatement('t1', 'u1', 's1');
      expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'commission_statement', 's1');
    });
  });
});
