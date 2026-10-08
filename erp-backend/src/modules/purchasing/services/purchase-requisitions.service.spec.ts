import { BadRequestException, ConflictException } from '@nestjs/common';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import { PurchaseRequisitionStatus } from '../entities/purchase-requisition.entity';

describe('PurchaseRequisitionsService', () => {
  let service: PurchaseRequisitionsService;
  let ordersService: Record<string, jest.Mock>;
  let settings: Record<string, jest.Mock>;
  let requisitionRepo: Record<string, jest.Mock>;

  const requisition = (status: PurchaseRequisitionStatus) => ({
    id: 'req-1',
    requisitionNumber: 'PR-1',
    status,
    warehouseId: 'wh1',
    departmentName: 'IT',
    lines: [
      { id: 'l1', productId: 'p1', quantity: 2, estimatedPrice: 10, supplierId: null },
      { id: 'l2', productId: 'p2', quantity: 3, estimatedPrice: null, supplierId: 's2' },
      { id: 'l3', productId: 'p3', quantity: 1, estimatedPrice: null, supplierId: null },
    ],
  });

  beforeEach(() => {
    let n = 0;
    ordersService = { create: jest.fn(async (_t, _u, dto) => ({ id: `po-${++n}`, ...dto })) };
    settings = { get: jest.fn().mockResolvedValue({ requisitionApprovalRequired: true }) };
    requisitionRepo = { save: jest.fn((x) => x), create: jest.fn((x) => x), findOne: jest.fn() };
    service = new PurchaseRequisitionsService(
      requisitionRepo as any,
      { create: jest.fn((x) => x), save: jest.fn((x) => x) } as any,
      {
        find: jest.fn().mockResolvedValue([
          { id: 'p1', code: 'P1', preferredSupplierId: 's1', costPrice: 5, purchaseTaxRate: 14 },
          { id: 'p2', code: 'P2', preferredSupplierId: 's1', costPrice: 7, purchaseTaxRate: 0 },
          { id: 'p3', code: 'P3', preferredSupplierId: 's1', costPrice: 9, purchaseTaxRate: 0 },
        ]),
        count: jest.fn(),
      } as any,
      ordersService as any,
      settings as any,
      { next: jest.fn() } as any,
    );
  });

  it('converts approved requisitions into one RFQ per vendor', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(requisition(PurchaseRequisitionStatus.APPROVED) as any);

    const { orders } = await service.convert('t1', 'u1', 'req-1');

    expect(orders).toHaveLength(2);
    const s1 = ordersService.create.mock.calls.find((c) => c[2].supplierId === 's1');
    expect(s1[2].lines).toEqual([
      expect.objectContaining({ productId: 'p1', quantity: 2, unitPrice: 10, taxRate: 14 }),
      expect.objectContaining({ productId: 'p3', quantity: 1, unitPrice: 9 }),
    ]);
    expect(s1[2].warehouseId).toBe('wh1');
    expect(s1[3]).toEqual({ requisitionId: 'req-1' });
    expect(requisitionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PurchaseRequisitionStatus.CONVERTED, purchaseOrderIds: ['po-1', 'po-2'] }),
    );
  });

  it('requires approval before conversion when configured', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(requisition(PurchaseRequisitionStatus.SUBMITTED) as any);
    await expect(service.convert('t1', 'u1', 'req-1')).rejects.toThrow(ConflictException);

    settings.get.mockResolvedValue({ requisitionApprovalRequired: false });
    await expect(service.convert('t1', 'u1', 'req-1')).resolves.toBeDefined();
  });

  it('refuses lines without any vendor', async () => {
    const req = requisition(PurchaseRequisitionStatus.APPROVED);
    jest.spyOn(service, 'findById').mockResolvedValue(req as any);
    (service as any).productRepo.find.mockResolvedValue([{ id: 'p1', code: 'P1' }]);
    await expect(service.convert('t1', 'u1', 'req-1')).rejects.toThrow(BadRequestException);
  });

  it('follows the submit / approve workflow', async () => {
    jest.spyOn(service, 'findById').mockResolvedValue(requisition(PurchaseRequisitionStatus.DRAFT) as any);
    await expect(service.approve('t1', 'u1', 'req-1')).rejects.toThrow(ConflictException);
    const submitted = await service.submit('t1', 'req-1');
    expect(submitted.status).toBe(PurchaseRequisitionStatus.SUBMITTED);
  });
});
