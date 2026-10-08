import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrder, PurchaseOrderStatus } from '../entities/purchase-order.entity';
import { PurchaseOrderLine } from '../entities/purchase-order-line.entity';
import { Supplier } from '../entities/supplier.entity';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { StockService } from '@modules/inventory/services/stock.service';
import { SequenceService } from '@shared/services/sequence.service';
import { PurchasingSettingsService } from './purchasing-settings.service';
import { RbacService } from '@modules/auth/services/rbac.service';

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let orderRepo: Record<string, jest.Mock>;
  let lineRepo: Record<string, jest.Mock>;
  let eventEmitter: Record<string, jest.Mock>;
  let supplierRepo: Record<string, jest.Mock>;
  let productRepo: Record<string, jest.Mock>;
  let sequence: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let invoicesService: Record<string, jest.Mock>;
  let settingsService: Record<string, jest.Mock>;
  let rbac: Record<string, jest.Mock>;

  const mockOrder = {
    id: 'po-1',
    orderNumber: 'PO-000001',
    tenantId: 'tenant-1',
    status: PurchaseOrderStatus.DRAFT,
    totalAmount: 500,
    lines: [],
    supplier: { id: 'sup-1' },
  };

  beforeEach(async () => {
    orderRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'po-1', ...entity })),
      count: jest.fn(),
    };
    lineRepo = {
      create: jest.fn((dto) => dto),
    };
    eventEmitter = {
      emit: jest.fn(),
    };
    lineRepo.save = jest.fn((lines) => lines);
    supplierRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'sup-1', isActive: true }),
    };
    productRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    sequence = { next: jest.fn().mockResolvedValue('PO-000001') };
    stockService = {
      isStockable: jest.fn().mockResolvedValue(true),
      receive: jest.fn().mockResolvedValue({}),
    };
    invoicesService = {
      create: jest.fn((_t, _u, dto) => ({ id: 'bill-1', ...dto })),
      approve: jest.fn(),
    };

    settingsService = { get: jest.fn().mockResolvedValue({ poApprovalThreshold: 0 }) };
    rbac = { hasPermission: jest.fn().mockResolvedValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: getRepositoryToken(PurchaseOrder), useValue: orderRepo },
        { provide: getRepositoryToken(PurchaseOrderLine), useValue: lineRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: getRepositoryToken(Supplier), useValue: supplierRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: SequenceService, useValue: sequence },
        { provide: StockService, useValue: stockService },
        { provide: PurchaseInvoicesService, useValue: invoicesService },
        { provide: PurchasingSettingsService, useValue: settingsService },
        { provide: RbacService, useValue: rbac },
      ],
    }).compile();

    service = module.get<PurchaseOrdersService>(PurchaseOrdersService);
  });

  describe('create', () => {
    const createDto = {
      supplierId: 'sup-1',
      lines: [{ productId: 'prod-1', quantity: 10, unitPrice: 50 }],
    } as any;

    it('should create an order with auto-generated number', async () => {

      const result = await service.create('tenant-1', 'user-1', createDto);

      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderNumber: 'PO-000001',
          status: PurchaseOrderStatus.DRAFT,
          tenantId: 'tenant-1',
          createdBy: 'user-1',
        }),
      );
      expect(orderRepo.save).toHaveBeenCalled();
    });

    it('should take the order number from the tenant sequence', async () => {
      sequence.next.mockResolvedValue('PO-000043');

      await service.create('tenant-1', 'user-1', createDto);

      expect(sequence.next).toHaveBeenCalledWith('tenant-1', 'purchase_order', 'PO');
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderNumber: 'PO-000043',
        }),
      );
    });

    it('should ignore client totals and recompute them from the lines', async () => {
      await service.create('tenant-1', 'user-1', {
        supplierId: 'sup-1',
        subtotal: 1,
        taxAmount: 1,
        totalAmount: 1,
        lines: [{ productId: 'prod-1', quantity: 10, unitPrice: 50, discount: 50, taxRate: 14 }],
      } as any);

      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ subtotal: 450, taxAmount: 63, totalAmount: 513 }),
      );
    });

    it('should reject archived suppliers', async () => {
      supplierRepo.findOne.mockResolvedValue({ id: 'sup-1', isActive: false });

      await expect(service.create('tenant-1', 'user-1', createDto)).rejects.toThrow();
    });
  });

  describe('findAll', () => {
    it('should return all orders for a tenant', async () => {
      orderRepo.find.mockResolvedValue([mockOrder]);

      const result = await service.findAll('tenant-1');

      expect(orderRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        relations: ['lines', 'supplier'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return an order by id', async () => {
      orderRepo.findOne.mockResolvedValue(mockOrder);

      const result = await service.findById('tenant-1', 'po-1');

      expect(result).toEqual(mockOrder);
    });

    it('should throw NotFoundException if order not found', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirm', () => {
    it('should confirm a draft order', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: PurchaseOrderStatus.DRAFT });
      orderRepo.save.mockImplementation((entity) => entity);

      const result = await service.confirm('tenant-1', 'user-1', 'po-1');

      expect(result.status).toBe(PurchaseOrderStatus.CONFIRMED);
      expect(eventEmitter.emit).toHaveBeenCalledWith('purchase.received', expect.any(Object));
    });

    it('should throw ConflictException if order is not draft', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: PurchaseOrderStatus.CONFIRMED });

      await expect(service.confirm('tenant-1', 'user-1', 'po-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a draft order', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: PurchaseOrderStatus.DRAFT });
      orderRepo.save.mockImplementation((entity) => entity);

      const result = await service.cancel('tenant-1', 'po-1');

      expect(result.status).toBe(PurchaseOrderStatus.CANCELLED);
    });

    it('should throw ConflictException if order is already cancelled', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: PurchaseOrderStatus.CANCELLED });

      await expect(service.cancel('tenant-1', 'po-1')).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if order is received', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: PurchaseOrderStatus.RECEIVED });

      await expect(service.cancel('tenant-1', 'po-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('receive', () => {
    const confirmed = () => ({
      ...mockOrder,
      status: PurchaseOrderStatus.CONFIRMED,
      warehouseId: 'wh-1',
      exchangeRate: 1,
      lines: [
        { id: 'l1', productId: 'prod-1', quantity: 10, lineTotal: 450, qtyReceived: 0, qtyBilled: 0, discount: 50, unitPrice: 50, taxRate: 0 },
      ],
    });

    it('should receive remaining quantities at net unit cost and close the order', async () => {
      orderRepo.findOne.mockResolvedValue(confirmed());
      orderRepo.save.mockImplementation((e) => e);

      const result = await service.receive('tenant-1', 'user-1', 'po-1');

      expect(stockService.receive).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        expect.objectContaining({ productId: 'prod-1', warehouseId: 'wh-1', quantity: 10, unitCost: 45 }),
      );
      expect(result.status).toBe(PurchaseOrderStatus.RECEIVED);
    });

    it('should support partial receipts', async () => {
      orderRepo.findOne.mockResolvedValue(confirmed());
      orderRepo.save.mockImplementation((e) => e);

      const result = await service.receive('tenant-1', 'user-1', 'po-1', {
        lines: [{ lineId: 'l1', quantity: 4 }],
      });

      expect(result.status).toBe(PurchaseOrderStatus.CONFIRMED);
      expect(result.lines[0].qtyReceived).toBe(4);
    });

    it('should reject receiving more than ordered', async () => {
      orderRepo.findOne.mockResolvedValue(confirmed());

      await expect(
        service.receive('tenant-1', 'user-1', 'po-1', { lines: [{ lineId: 'l1', quantity: 11 }] }),
      ).rejects.toThrow();
    });
  });

  describe('createBill', () => {
    it('should bill goods on received quantities only', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...mockOrder,
        status: PurchaseOrderStatus.CONFIRMED,
        exchangeRate: 1,
        lines: [
          { id: 'l1', productId: 'prod-1', quantity: 10, qtyReceived: 4, qtyBilled: 0, unitPrice: 50, discount: 0, taxRate: 14 },
        ],
      });
      productRepo.find.mockResolvedValue([{ id: 'prod-1', type: ProductType.GOODS }]);

      await service.createBill('tenant-1', 'user-1', 'po-1');

      expect(invoicesService.create).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        expect.objectContaining({
          lines: [expect.objectContaining({ productId: 'prod-1', quantity: 4, orderLineId: 'l1' })],
        }),
      );
    });

    it('should refuse to bill goods that were not received', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...mockOrder,
        status: PurchaseOrderStatus.CONFIRMED,
        lines: [{ id: 'l1', productId: 'prod-1', quantity: 10, qtyReceived: 0, qtyBilled: 0 }],
      });
      productRepo.find.mockResolvedValue([{ id: 'prod-1', type: ProductType.GOODS }]);

      await expect(service.createBill('tenant-1', 'user-1', 'po-1')).rejects.toThrow();
    });
  });

  describe('approval workflow', () => {
    beforeEach(() => {
      settingsService.get.mockResolvedValue({ poApprovalThreshold: 1000 });
    });

    it('sends orders above the threshold to approval when the user cannot approve', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, totalAmount: 600, exchangeRate: 2 });

      const result = await service.confirm('tenant-1', 'user-1', 'po-1');

      expect(result.status).toBe(PurchaseOrderStatus.TO_APPROVE);
      expect(rbac.hasPermission).toHaveBeenCalledWith('tenant-1', 'user-1', {
        module: 'purchasing',
        screen: 'po_approval',
        action: 'approve',
      });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('confirms orders under the threshold without approval', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, totalAmount: 900, exchangeRate: 1 });
      const result = await service.confirm('tenant-1', 'user-1', 'po-1');
      expect(result.status).toBe(PurchaseOrderStatus.CONFIRMED);
      expect(rbac.hasPermission).not.toHaveBeenCalled();
    });

    it('approves and confirms at once for approvers', async () => {
      rbac.hasPermission.mockResolvedValue(true);
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, totalAmount: 5000 });
      const result = await service.confirm('tenant-1', 'boss', 'po-1');
      expect(result.status).toBe(PurchaseOrderStatus.CONFIRMED);
      expect(result.approvedBy).toBe('boss');
    });

    it('refuses to confirm an order waiting for approval and approves it via approve()', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: PurchaseOrderStatus.TO_APPROVE, totalAmount: 5000 });
      await expect(service.confirm('tenant-1', 'user-1', 'po-1')).rejects.toThrow(ConflictException);

      const approved = await service.approve('tenant-1', 'boss', 'po-1');
      expect(approved.status).toBe(PurchaseOrderStatus.CONFIRMED);
      expect(approved.approvedBy).toBe('boss');
    });

    it('rejects back to draft with a reason', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: PurchaseOrderStatus.TO_APPROVE });
      const result = await service.reject('tenant-1', 'po-1', 'too expensive');
      expect(result.status).toBe(PurchaseOrderStatus.DRAFT);
      expect(result.rejectionReason).toBe('too expensive');
    });
  });

  it('computes tax-inclusive totals on creation', async () => {
    await service.create('tenant-1', 'user-1', {
      supplierId: 'sup-1',
      pricesIncludeTax: true,
      lines: [{ productId: 'prod-1', quantity: 2, unitPrice: 57, taxRate: 14 }],
    } as any);
    expect(orderRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ subtotal: 100, taxAmount: 14, totalAmount: 114, pricesIncludeTax: true }),
    );
  });
});
