import { BadRequestException, ConflictException } from '@nestjs/common';
import { StockIssuesService, STOCK_ISSUE_ACCOUNT } from './stock-issues.service';
import { StockIssueStatus, StockIssueType } from '../entities/stock-issue.entity';
import { ProductType } from '../entities/product.entity';

describe('StockIssuesService', () => {
  let service: StockIssuesService;
  let stored: any;
  let stockService: any;
  let autoPosting: any;
  let productRepo: any;
  let accountRepo: any;

  const lines = () => autoPosting.post.mock.calls[0][0].buildLines({}, (k: string) => k);

  beforeEach(() => {
    stored = null;
    const issueRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => (stored = { ...(stored ?? {}), id: 'iss-1', ...x, lines: x.lines ?? stored?.lines })),
      findOne: jest.fn(async () => stored),
      find: jest.fn(),
    };
    const lineRepo = { create: jest.fn((x) => x), save: jest.fn() };
    productRepo = { findOne: jest.fn().mockResolvedValue({ id: 'p1', code: 'P1', type: ProductType.GOODS }) };
    accountRepo = { findOne: jest.fn() };
    stockService = {
      issue: jest.fn().mockResolvedValue({ unitCost: 5, cost: 50, lots: [{ lotNumber: 'L1', quantity: 10, expiryDate: null }] }),
      receive: jest.fn(),
    };
    autoPosting = { preflight: jest.fn(), post: jest.fn(), reverseSource: jest.fn() };
    service = new StockIssuesService(
      issueRepo as any,
      lineRepo as any,
      productRepo,
      { findOne: jest.fn().mockResolvedValue({ id: 'w1' }) } as any,
      accountRepo,
      stockService,
      { toBaseQuantity: jest.fn(async (_t, _p, q, unitId) => (unitId ? q * 12 : q)) } as any,
      { next: jest.fn().mockResolvedValue('ISS-000001') } as any,
      autoPosting,
    );
  });

  it('maps types to default expense accounts', () => {
    expect(STOCK_ISSUE_ACCOUNT[StockIssueType.DAMAGE]).toBe('stockAdjustmentAccountId');
    expect(STOCK_ISSUE_ACCOUNT[StockIssueType.DONATION]).toBe('donationsExpenseAccountId');
  });

  it('creates drafts in base units without moving stock', async () => {
    const issue = await service.create('t1', 'u1', {
      type: StockIssueType.DONATION,
      warehouseId: 'w1',
      lines: [{ productId: 'p1', quantity: 2, unitId: 'box' }],
    });
    expect(issue.status).toBe(StockIssueStatus.DRAFT);
    expect(issue.lines[0]).toEqual(expect.objectContaining({ quantity: 24, enteredQuantity: 2 }));
    expect(stockService.issue).not.toHaveBeenCalled();
  });

  it('posts a donation: issues at average cost, Dr donations / Cr inventory', async () => {
    await service.create('t1', 'u1', {
      type: StockIssueType.DONATION,
      warehouseId: 'w1',
      lines: [{ productId: 'p1', quantity: 10 }],
      post: true,
    });
    expect(autoPosting.preflight.mock.calls[0][2]).toEqual(['inventoryAccountId', 'donationsExpenseAccountId']);
    expect(stockService.issue.mock.calls[0][2]).toEqual(
      expect.objectContaining({ productId: 'p1', quantity: 10, referenceType: 'stock_issue' }),
    );
    expect(lines()).toEqual([
      { accountId: 'donationsExpenseAccountId', debit: 50 },
      { accountId: 'inventoryAccountId', credit: 50 },
    ]);
    expect(stored.status).toBe(StockIssueStatus.POSTED);
    expect(stored.totalCost).toBe(50);
  });

  it('damage may consume expired lots; an explicit account overrides the default', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'acc', isActive: true, allowPosting: true });
    await service.create('t1', 'u1', {
      type: StockIssueType.DAMAGE,
      warehouseId: 'w1',
      expenseAccountId: 'acc',
      lines: [{ productId: 'p1', quantity: 10 }],
      post: true,
    });
    expect(stockService.issue.mock.calls[0][3]).toEqual(expect.objectContaining({ includeExpiredLots: true }));
    expect(autoPosting.preflight.mock.calls[0][2]).toEqual(['inventoryAccountId']);
    expect(lines()[0]).toEqual({ accountId: 'acc', debit: 50 });
  });

  it('rejects services and lot quantities that do not add up', async () => {
    await expect(
      service.create('t1', 'u1', {
        type: StockIssueType.SAMPLE,
        warehouseId: 'w1',
        lines: [{ productId: 'p1', quantity: 5, lots: [{ lotNumber: 'L1', quantity: 4 }] }],
      }),
    ).rejects.toThrow(BadRequestException);
    productRepo.findOne.mockResolvedValue({ id: 'p1', code: 'S', type: ProductType.SERVICE });
    await expect(
      service.create('t1', 'u1', {
        type: StockIssueType.SAMPLE,
        warehouseId: 'w1',
        lines: [{ productId: 'p1', quantity: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('cancelling a posted issue receives the goods back at the issued cost and lots', async () => {
    await service.create('t1', 'u1', {
      type: StockIssueType.INTERNAL_USE,
      warehouseId: 'w1',
      lines: [{ productId: 'p1', quantity: 10 }],
      post: true,
    });
    await service.cancel('t1', 'u1', 'iss-1');
    expect(stockService.receive).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ quantity: 10, unitCost: 5 }),
      expect.objectContaining({ lotAllocations: [{ lotNumber: 'L1', quantity: 10, expiryDate: null }] }),
    );
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'stock_issue', 'iss-1');
    expect(stored.status).toBe(StockIssueStatus.CANCELLED);
    await expect(service.post('t1', 'u1', 'iss-1')).rejects.toThrow(ConflictException);
  });
});
