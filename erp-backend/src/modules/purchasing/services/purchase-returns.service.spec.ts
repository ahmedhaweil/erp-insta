import { BadRequestException } from '@nestjs/common';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseReturnRefundMethod, PurchaseReturnStatus } from '../entities/purchase-return.entity';
import { PurchaseInvoiceStatus, PurchaseInvoiceType } from '../entities/purchase-invoice.entity';
import { ProductType } from '@modules/inventory/entities/product.entity';

describe('PurchaseReturnsService', () => {
  let service: PurchaseReturnsService;
  let returnRepo: Record<string, jest.Mock>;
  let billLineRepo: Record<string, jest.Mock>;
  let invoicesService: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;

  const bill = () => ({
    id: 'bill-1',
    invoiceNumber: 'PINV-1',
    supplierId: 's1',
    moveType: PurchaseInvoiceType.BILL,
    status: PurchaseInvoiceStatus.APPROVED,
    exchangeRate: 1,
    withholdingRate: 0,
    lines: [
      { id: 'bl1', productId: 'p1', quantity: 10, qtyReturned: 0, unitPrice: 60, discount: 0, taxRate: 14 },
      { id: 'bl2', productId: 'svc', quantity: 1, qtyReturned: 1, unitPrice: 100, discount: 0, taxRate: 14 },
    ],
  });

  const draft = (overrides: Record<string, unknown> = {}) => ({
    id: 'pr-1',
    returnNumber: 'PRET-1',
    supplierId: 's1',
    originalBillId: 'bill-1',
    warehouseId: 'wh1',
    date: '2026-03-01',
    status: PurchaseReturnStatus.DRAFT,
    refundMethod: PurchaseReturnRefundMethod.CREDIT,
    exchangeRate: 1,
    pricesIncludeTax: false,
    lines: [
      { id: 'l1', billLineId: 'bl1', productId: 'p1', quantity: 2, unitPrice: 60, discount: 0, taxRate: 14, lineTotal: 120, restock: true },
    ],
    ...overrides,
  });

  beforeEach(() => {
    returnRepo = { create: jest.fn((x) => x), save: jest.fn((x) => ({ id: 'pr-1', ...x })), findOne: jest.fn() };
    billLineRepo = { save: jest.fn((x) => x) };
    invoicesService = {
      findById: jest.fn(async (_t, id) =>
        id === 'bill-1' ? bill() : { id, totalAmount: 136.8, paidAmount: 0 },
      ),
      create: jest.fn(async (_t, _u, dto, extra) => ({ id: 'ref-1', ...dto, ...extra })),
      approve: jest.fn(async () => ({ id: 'ref-1', totalAmount: 136.8, paidAmount: 0 })),
      adjustSupplierBalance: jest.fn(),
      applyPayment: jest.fn(),
    };
    stockService = { issue: jest.fn().mockResolvedValue({ unitCost: 55, cost: 110 }) };
    autoPosting = { preflight: jest.fn(), post: jest.fn() };
    service = new PurchaseReturnsService(
      returnRepo as any,
      { create: jest.fn((x) => x), save: jest.fn((x) => x) } as any,
      billLineRepo as any,
      { findOne: jest.fn() } as any,
      {
        find: jest.fn().mockResolvedValue([
          { id: 'p1', type: ProductType.GOODS },
          { id: 'svc', type: ProductType.SERVICE },
        ]),
      } as any,
      invoicesService as any,
      stockService as any,
      autoPosting as any,
      { next: jest.fn().mockResolvedValue('PRET-1') } as any,
    );
  });

  it('refuses quantities above billed minus already returned', async () => {
    await expect(
      service.create('t1', 'u1', {
        originalBillId: 'bill-1',
        lines: [{ invoiceLineId: 'bl2', quantity: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('issues the goods from stock, creates and approves the vendor refund', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draft() as any);

    await service.post('t1', 'u1', 'pr-1');

    expect(stockService.issue).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ productId: 'p1', warehouseId: 'wh1', quantity: 2, referenceType: 'purchase_return' }),
    );
    expect(billLineRepo.save).toHaveBeenCalledWith([expect.objectContaining({ id: 'bl1', qtyReturned: 2 })]);
    expect(invoicesService.create).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ supplierId: 's1' }),
      expect.objectContaining({
        moveType: PurchaseInvoiceType.REFUND,
        reversedInvoiceId: 'bill-1',
        purchaseReturnId: 'pr-1',
      }),
    );
    expect(invoicesService.approve).toHaveBeenCalledWith('t1', 'ref-1', 'u1');

    // refund credits inventory at 120 while stock left at 110: +10 to stock adjustment
    const diff = autoPosting.post.mock.calls[0][0];
    const account = (k: string) => k;
    expect(diff.buildLines({ stockAdjustmentAccountId: 'adj' }, account)).toEqual([
      { accountId: 'inventoryAccountId', debit: 10 },
      { accountId: 'adj', credit: 10 },
    ]);
    expect(diff.buildLines({}, account)).toEqual([]);
    expect(returnRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PurchaseReturnStatus.POSTED, refundId: 'ref-1', costAmount: 110 }),
    );
  });

  it('records the cash received back from the vendor', async () => {
    stockService.issue.mockResolvedValue({ unitCost: 60, cost: 120 });
    jest.spyOn(service, 'findById').mockResolvedValue(draft({ refundMethod: PurchaseReturnRefundMethod.CASH }) as any);

    await service.post('t1', 'u1', 'pr-1');

    const cash = autoPosting.post.mock.calls[0][0];
    expect(cash.buildLines({}, (k: string) => k)).toEqual([
      { accountId: 'cashAccountId', debit: 136.8 },
      { accountId: 'payableAccountId', credit: 136.8 },
    ]);
    expect(invoicesService.adjustSupplierBalance).toHaveBeenCalledWith('t1', 's1', 136.8);
    expect(invoicesService.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'ref-1' }), 136.8);
  });

  it('requires a warehouse for stockable goods', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(draft({ warehouseId: null }) as any);
    await expect(service.post('t1', 'u1', 'pr-1')).rejects.toThrow(BadRequestException);
  });
});
