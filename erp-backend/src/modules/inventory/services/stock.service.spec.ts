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

  const mockProduct = { id: 'product-1', tenantId: 'tenant-1', code: 'PRD-001' };
  const mockWarehouse = { id: 'wh-1', tenantId: 'tenant-1', nameEn: 'Main Warehouse', nameAr: 'المستودع الرئيسي' };
  const mockWarehouse2 = { id: 'wh-2', tenantId: 'tenant-1', nameEn: 'Secondary', nameAr: 'ثانوي' };
  const mockStock = {
    id: 'stock-1',
    tenantId: 'tenant-1',
    productId: 'product-1',
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
    it('should return stock records for the tenant', async () => {
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

      await service.getStock('tenant-1', 'product-1', 'wh-1');

      expect(stockRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', productId: 'product-1', warehouseId: 'wh-1' },
        relations: ['product', 'warehouse'],
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('adjust', () => {
    const adjustDto = {
      productId: 'product-1',
      warehouseId: 'wh-1',
      quantity: 50,
      reason: 'Recount',
    };

    it('should create new stock record if none exists', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.findOne.mockResolvedValue(null);

      const result = await service.adjust('tenant-1', 'user-1', adjustDto as any);

      expect(stockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', productId: 'product-1' }),
      );
      expect(stockRepo.save).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith('stock.adjusted', expect.anything());
    });

    it('should add quantity to existing stock', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 100 });

      const result = await service.adjust('tenant-1', 'user-1', adjustDto as any);

      expect(stockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 150 }),
      );
    });

    it('should throw BadRequestException if adjustment results in negative stock', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 10 });

      const negativeDto = { ...adjustDto, quantity: -20 };

      await expect(
        service.adjust('tenant-1', 'user-1', negativeDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if product does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.adjust('tenant-1', 'user-1', adjustDto as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if warehouse does not exist', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne.mockResolvedValue(null);

      await expect(
        service.adjust('tenant-1', 'user-1', adjustDto as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('transfer', () => {
    const transferDto = {
      productId: 'product-1',
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
        .mockResolvedValueOnce({ ...mockStock, quantity: 100, reservedQty: 10 })
        .mockResolvedValueOnce(null);

      const result = await service.transfer('tenant-1', 'user-1', transferDto as any);

      expect(stockRepo.save).toHaveBeenCalledTimes(2);
      expect(movementRepo.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException if insufficient available stock', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);
      warehouseRepo.findOne
        .mockResolvedValueOnce(mockWarehouse)
        .mockResolvedValueOnce(mockWarehouse2);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 15, reservedQty: 10 });

      await expect(
        service.transfer('tenant-1', 'user-1', transferDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if source and destination are the same', async () => {
      const sameWarehouseDto = { ...transferDto, toWarehouseId: 'wh-1' };

      await expect(
        service.transfer('tenant-1', 'user-1', sameWarehouseDto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if transfer quantity is not positive', async () => {
      const zeroDto = { ...transferDto, quantity: 0 };

      await expect(
        service.transfer('tenant-1', 'user-1', zeroDto as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
