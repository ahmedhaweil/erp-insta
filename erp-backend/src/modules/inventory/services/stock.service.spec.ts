import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StockService } from './stock.service';
import { Stock } from '../entities/stock.entity';
import { StockMovement } from '../entities/stock-movement.entity';
import { Product } from '../entities/product.entity';
import { Warehouse } from '../entities/warehouse.entity';

describe('StockService', () => {
  let service: StockService;
  let stockRepo: Record<string, jest.Mock>;
  let movementRepo: Record<string, jest.Mock>;
  let productRepo: Record<string, jest.Mock>;
  let warehouseRepo: Record<string, jest.Mock>;
  let eventEmitter: Record<string, jest.Mock>;

  const mockProduct = { id: 'prod-1', tenantId: 'tenant-1' };
  const mockWarehouse = { id: 'wh-1', tenantId: 'tenant-1', nameEn: 'Main Warehouse' };
  const mockWarehouse2 = { id: 'wh-2', tenantId: 'tenant-1', nameEn: 'Secondary Warehouse' };
  const mockStock = {
    id: 'stock-1',
    tenantId: 'tenant-1',
    productId: 'prod-1',
    warehouseId: 'wh-1',
    quantity: 100,
    reservedQty: 10,
  };

  beforeEach(async () => {
    stockRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'stock-1', ...entity })),
    };
    movementRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => entity),
    };
    productRepo = {
      findOne: jest.fn(),
    };
    warehouseRepo = {
      findOne: jest.fn(),
    };
    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: getRepositoryToken(Stock), useValue: stockRepo },
        { provide: getRepositoryToken(StockMovement), useValue: movementRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(Warehouse), useValue: warehouseRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<StockService>(StockService);
  });

  describe('getStock', () => {
    it('should return stock filtered by tenant', async () => {
      stockRepo.find.mockResolvedValue([mockStock]);

      const result = await service.getStock('tenant-1');

      expect(stockRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        relations: ['product', 'warehouse'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });

    it('should filter by productId and warehouseId when provided', async () => {
      stockRepo.find.mockResolvedValue([mockStock]);

      await service.getStock('tenant-1', 'prod-1', 'wh-1');

      expect(stockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', productId: 'prod-1', warehouseId: 'wh-1' },
        }),
      );
    });
  });

  describe('adjust', () => {
    const adjustDto = { productId: 'prod-1', warehouseId: 'wh-1', quantity: 50, reason: 'restock' };

    it('should create new stock record when none exists', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.findOne.mockResolvedValue(null);
      stockRepo.save.mockResolvedValue({ id: 'stock-new', quantity: 50 });

      const result = await service.adjust('tenant-1', 'user-1', adjustDto);

      expect(stockRepo.create).toHaveBeenCalled();
      expect(stockRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });

    it('should add quantity to existing stock', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 100 });
      stockRepo.save.mockImplementation((entity) => entity);

      const result = await service.adjust('tenant-1', 'user-1', adjustDto);

      expect(result.quantity).toBe(150);
      expect(eventEmitter.emit).toHaveBeenCalledWith('stock.adjusted', expect.any(Object));
    });

    it('should throw BadRequestException if adjustment results in negative stock', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 10 });

      const negativeDto = { ...adjustDto, quantity: -20 };

      await expect(service.adjust('tenant-1', 'user-1', negativeDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if product not found', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(service.adjust('tenant-1', 'user-1', adjustDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('transfer', () => {
    const transferDto = {
      productId: 'prod-1',
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      quantity: 20,
    };

    it('should transfer stock between warehouses', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne
        .mockResolvedValueOnce(mockWarehouse)
        .mockResolvedValueOnce(mockWarehouse2);
      stockRepo.findOne
        .mockResolvedValueOnce({ ...mockStock, quantity: 100, reservedQty: 0 })
        .mockResolvedValueOnce(null);
      stockRepo.save.mockImplementation((entity) => entity);

      const result = await service.transfer('tenant-1', 'user-1', transferDto);

      expect(result.from.quantity).toBe(80);
      expect(result.to.quantity).toBe(20);
    });

    it('should throw BadRequestException if insufficient stock', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne
        .mockResolvedValueOnce(mockWarehouse)
        .mockResolvedValueOnce(mockWarehouse2);
      stockRepo.findOne.mockResolvedValueOnce({ ...mockStock, quantity: 5, reservedQty: 0 });

      await expect(service.transfer('tenant-1', 'user-1', transferDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if same warehouse', async () => {
      const sameWhDto = { ...transferDto, toWarehouseId: 'wh-1' };

      await expect(service.transfer('tenant-1', 'user-1', sameWhDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException if no stock in source warehouse', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne
        .mockResolvedValueOnce(mockWarehouse)
        .mockResolvedValueOnce(mockWarehouse2);
      stockRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.transfer('tenant-1', 'user-1', transferDto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
