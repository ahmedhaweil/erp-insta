import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SalesOrdersService } from './sales-orders.service';
import { SalesOrder, SalesOrderStatus } from '../entities/sales-order.entity';
import { SalesOrderLine } from '../entities/sales-order-line.entity';
import { Customer } from '../entities/customer.entity';
import { SalesInvoicesService } from './sales-invoices.service';
import { StockService } from '@modules/inventory/services/stock.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { SequenceService } from '@shared/services/sequence.service';

describe('SalesOrdersService', () => {
  let service: SalesOrdersService;
  let orderRepo: Record<string, jest.Mock>;
  let lineRepo: Record<string, jest.Mock>;
  let eventEmitter: Record<string, jest.Mock>;
  let customerRepo: Record<string, jest.Mock>;
  let sequence: Record<string, jest.Mock>;
  let stockService: Record<string, jest.Mock>;
  let invoicesService: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;

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
    lineRepo.save = jest.fn((lines) => lines);
    customerRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'cust-1', isActive: true }),
    };
    sequence = { next: jest.fn().mockResolvedValue('SO-000001') };
    stockService = {
      reserve: jest.fn((_t, _p, _w, qty) => qty),
      release: jest.fn(),
      issue: jest.fn().mockResolvedValue({ unitCost: 30, cost: 60 }),
      isStockable: jest.fn().mockResolvedValue(true),
    };
    invoicesService = {
      create: jest.fn((_t, _u, dto) => ({ id: 'inv-1', ...dto })),
      post: jest.fn(),
    };
    autoPosting = { post: jest.fn().mockResolvedValue(null), preflight: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesOrdersService,
        { provide: getRepositoryToken(SalesOrder), useValue: orderRepo },
        { provide: getRepositoryToken(SalesOrderLine), useValue: lineRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: SequenceService, useValue: sequence },
        { provide: StockService, useValue: stockService },
        { provide: SalesInvoicesService, useValue: invoicesService },
        { provide: AutoPostingService, useValue: autoPosting },
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

    it('should ignore a tampered client lineTotal', async () => {
      await service.create('tenant-1', 'user-1', {
        customerId: 'cust-1',
        lines: [{ productId: 'prod-1', quantity: 2, unitPrice: 50, lineTotal: 1, taxRate: 15 }],
      } as any);

      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ subtotal: 100, taxAmount: 15, totalAmount: 115 }),
      );
    });

    it('should calculate totals from lines', async () => {
      sequence.next.mockResolvedValue('SO-000006');

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

  describe('business rules', () => {
    const line = () => ({
      id: 'l1',
      productId: 'prod-1',
      quantity: 2,
      unitPrice: 50,
      discount: 0,
      taxRate: 15,
      qtyDelivered: 0,
      qtyInvoiced: 0,
      qtyReserved: 0,
    });

    it('should block confirmation above the customer credit limit', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...mockOrder,
        customer: { id: 'cust-1', creditLimit: 100, balance: 50 },
      });

      await expect(service.confirm('tenant-1', 'user-1', 'order-1')).rejects.toThrow(
        'Credit limit exceeded',
      );
    });

    it('should refuse to confirm an expired quotation', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, validityDate: '2000-01-01' });

      await expect(service.confirm('tenant-1', 'user-1', 'order-1')).rejects.toThrow(ConflictException);
    });

    it('should reserve stock in the order warehouse on confirmation', async () => {
      orderRepo.findOne.mockResolvedValue({ ...mockOrder, warehouseId: 'wh-1', lines: [line()] });
      orderRepo.save.mockImplementation((e) => e);

      await service.confirm('tenant-1', 'user-1', 'order-1');

      expect(stockService.reserve).toHaveBeenCalledWith('tenant-1', 'prod-1', 'wh-1', 2);
    });

    it('should deliver, consume the reservation and post COGS', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...mockOrder,
        status: SalesOrderStatus.CONFIRMED,
        warehouseId: 'wh-1',
        lines: [{ ...line(), qtyReserved: 2 }],
      });
      orderRepo.save.mockImplementation((e) => e);

      const result = await service.deliver('tenant-1', 'user-1', 'order-1');

      expect(stockService.issue).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        expect.objectContaining({ quantity: 2, releaseReserved: 2, warehouseId: 'wh-1' }),
      );
      expect(autoPosting.post).toHaveBeenCalledWith(
        expect.objectContaining({ sourceType: 'sales_delivery' }),
      );
      expect(result.status).toBe(SalesOrderStatus.DELIVERED);
    });

    it('should invoice only delivered quantities with the delivered policy', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...mockOrder,
        status: SalesOrderStatus.CONFIRMED,
        lines: [{ ...line(), qtyDelivered: 1 }],
      });

      await service.createInvoice('tenant-1', 'user-1', 'order-1', { policy: 'delivered' });

      expect(invoicesService.create).toHaveBeenCalledWith(
        'tenant-1',
        'user-1',
        expect.objectContaining({
          orderId: 'order-1',
          lines: [expect.objectContaining({ quantity: 1, orderLineId: 'l1' })],
        }),
      );
    });

    it('should not cancel an order that has been invoiced', async () => {
      orderRepo.findOne.mockResolvedValue({
        ...mockOrder,
        status: SalesOrderStatus.CONFIRMED,
        lines: [{ ...line(), qtyInvoiced: 2 }],
      });

      await expect(service.cancel('tenant-1', 'order-1')).rejects.toThrow(ConflictException);
    });
  });
});
