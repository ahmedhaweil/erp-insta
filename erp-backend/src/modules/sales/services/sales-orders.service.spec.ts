import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrder, SalesOrderStatus } from '../entities/sales-order.entity';
import { SalesOrderLine } from '../entities/sales-order-line.entity';

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;
  let orderRepo: Record<string, jest.Mock>;
  let lineRepo: Record<string, jest.Mock>;
  let eventEmitter: Record<string, jest.Mock>;

  const mockOrder = {
    id: 'order-1',
    orderNumber: 'SO-000001',
    tenantId: 'tenant-1',
    status: SalesOrderStatus.DRAFT,
    subtotal: 100,
    taxAmount: 15,
    totalAmount: 115,
    lines: [],
    customer: { id: 'cust-1' },
  };

  beforeEach(async () => {
    orderRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'order-1', ...entity })),
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
        SalesOrdersService,
        { provide: getRepositoryToken(SalesOrder), useValue: orderRepo },
        { provide: getRepositoryToken(SalesOrderLine), useValue: lineRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<SalesOrdersService>(SalesOrdersService);
  });

  describe('create', () => {
    const createDto = {
      customerId: 'cust-1',
      lines: [{ productId: 'prod-1', quantity: 2, unitPrice: 50, lineTotal: 100, taxRate: 15 }],
    } as any;

    it('should create an order with auto-generated number', async () => {
      orderRepo.count.mockResolvedValue(0);

      const result = await service.create('tenant-1', 'user-1', createDto);

      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderNumber: 'SO-000001',
          status: SalesOrderStatus.DRAFT,
          tenantId: 'tenant-1',
          createdBy: 'user-1',
        }),
      );
      expect(orderRepo.save).toHaveBeenCalled();
    });

    it('should calculate totals from lines', async () => {
      orderRepo.count.mockResolvedValue(5);

      await service.create('tenant-1', 'user-1', createDto);

      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderNumber: 'SO-000006',
          subtotal: 100,
          taxAmount: 15,
          totalAmount: 115,
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
        relations: ['lines', 'customer'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return an order by id', async () => {
      orderRepo.findOne.mockResolvedValue(mockOrder);

      const result = await service.findById('tenant-1', 'order-1');

      expect(result).toEqual(mockOrder);
    });

    it('should throw NotFoundException if order not found', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirm', () => {
    it('should confirm a draft order', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: SalesOrderStatus.DRAFT });
      orderRepo.save.mockImplementation((entity) => entity);

      const result = await service.confirm('tenant-1', 'user-1', 'order-1');

      expect(result.status).toBe(SalesOrderStatus.CONFIRMED);
      expect(eventEmitter.emit).toHaveBeenCalledWith('order.confirmed', expect.any(Object));
    });

    it('should throw ConflictException if order is not draft', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: SalesOrderStatus.CONFIRMED });

      await expect(service.confirm('tenant-1', 'user-1', 'order-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('cancel', () => {
    it('should cancel a draft order', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: SalesOrderStatus.DRAFT });
      orderRepo.save.mockImplementation((entity) => entity);

      const result = await service.cancel('tenant-1', 'order-1');

      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
    });

    it('should throw ConflictException if order is already cancelled', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: SalesOrderStatus.CANCELLED });

      await expect(service.cancel('tenant-1', 'order-1')).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if order is delivered', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, status: SalesOrderStatus.DELIVERED });

      await expect(service.cancel('tenant-1', 'order-1')).rejects.toThrow(ConflictException);
    });
  });
});
