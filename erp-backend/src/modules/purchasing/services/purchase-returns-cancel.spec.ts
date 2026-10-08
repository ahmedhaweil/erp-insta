import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseReturnRefundMethod, PurchaseReturnStatus } from '../entities/purchase-return.entity';
import { PurchaseInvoiceStatus } from '../entities/purchase-invoice.entity';
import { ProductType } from '@modules/inventory/entities/product.entity';

describe('PurchaseReturnsService.cancel (posted)', () => {
  let current: any;
  let invoicesService: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let service: PurchaseReturnsService;

  beforeEach(() => {
    current = {
      id: 'pr-1',
      returnNumber: 'PRET-1',
      supplierId: 's1',
      originalBillId: 'bill-1',
      warehouseId: 'w1',
      status: PurchaseReturnStatus.POSTED,
      refundMethod: PurchaseReturnRefundMethod.CASH,
      refundId: 'rf-1',
      appliedAmount: 30,
      refundedAmount: 70,
      lines: [
        { id: 'l1', billLineId: 'bl1', productId: 'p1', quantity: 1, unitFactor: 12, unitCost: 5, restock: true, lots: [{ lotNumber: 'B1', quantity: 12, expiryDate: '2027-01-01' }] },
      ],
    };
    invoicesService = {
      findById: jest.fn(async (_t, id) =>
        id === 'bill-1'
          ? { id, paidAmount: 30, lines: [{ id: 'bl1', qtyReturned: 1 }] }
          : { id, invoiceNumber: 'RBILL-1', paidAmount: current.refundPaid ?? 100, status: PurchaseInvoiceStatus.PAID },
      ),
      applyPayment: jest.fn(),
      setPaidAmount: jest.fn(),
      cancel: jest.fn(),
      adjustSupplierBalance: jest.fn(),
    };
    stockService = { receive: jest.fn() };
    autoPosting = { preflight: jest.fn(), reverseSource: jest.fn() };
    service = new PurchaseReturnsService(
      { findOne: jest.fn(async () => current), save: jest.fn(async (x) => x) } as any,
      {} as any,
      { save: jest.fn((x) => x) } as any,
      {} as any,
      { find: jest.fn(async () => [{ id: 'p1', type: ProductType.GOODS }]) } as any,
      invoicesService as any,
      stockService as any,
      autoPosting as any,
      {} as any,
    );
  });

  it('re-receives the same lots in base units and reverses refund, cash and valuation entries', async () => {
    await service.cancel('t1', 'pr-1', 'u1');
    expect(stockService.receive).toHaveBeenCalledWith(
      't1',
      'u1',
      expect.objectContaining({ quantity: 12, unitCost: 5, lots: current.lines[0].lots, referenceType: 'purchase_return_cancel' }),
    );
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'purchase_return', 'pr-1', expect.any(String));
    expect(autoPosting.reverseSource).toHaveBeenCalledWith('t1', 'u1', 'purchase_return_refund', 'pr-1', expect.any(String));
    expect(invoicesService.adjustSupplierBalance).toHaveBeenCalledWith('t1', 's1', -70);
    expect(invoicesService.applyPayment).toHaveBeenCalledWith(expect.objectContaining({ id: 'bill-1' }), -30);
    expect(invoicesService.cancel).toHaveBeenCalledWith('t1', 'u1', 'rf-1');
    expect(current.status).toBe(PurchaseReturnStatus.CANCELLED);
  });

  it('refuses when the vendor refund was settled through another payment', async () => {
    current.refundPaid = 150;
    await expect(service.cancel('t1', 'pr-1', 'u1')).rejects.toThrow(/already settled/);
    expect(stockService.receive).not.toHaveBeenCalled();
  });
});
