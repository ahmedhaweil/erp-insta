import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrder, PurchaseOrderStatus } from '../entities/purchase-order.entity';
import { PurchaseOrderLine } from '../entities/purchase-order-line.entity';

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let orderRepo: Record<string, jest.Mock>;
  let lineRepo: Record<string, jest.Mock>;
  let eventEmitter: Record<string, jest.Mock>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: getRepositoryToken(PurchaseOrder), useValue: orderRepo },
        { provide: getRepositoryToken(PurchaseOrderLine), useValue: lineRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
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
      orderRepo.count.mockResolvedValue(0);

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

    it('should increment order number based on existing count', async () => {
      orderRepo.count.mockResolvedValue(42);

      await service.create('tenant-1', 'user-1', createDto);

      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderNumber: 'PO-000043',
        }),
      );
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
});
