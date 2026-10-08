import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StockService } from './stock.service';
import { Stock } from '../entities/stock.entity';
import { StockMovement } from '../entities/stock-movement.entity';
import { Product } from '../entities/product.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { LotsService } from './lots.service';
import { InventorySettingsService } from './inventory-settings.service';
import { ProductsService } from './products.service';
import { StockMovementType } from '../entities/stock-movement.entity';

describe('StockService', () => {
  let service: StockService;
  let stockRepo: Record<string, jest.Mock>;
  let movementRepo: Record<string, jest.Mock>;
  let productRepo: Record<string, jest.Mock>;
  let warehouseRepo: Record<string, jest.Mock>;
  let eventEmitter: Record<string, jest.Mock>;
  let lotsService: Record<string, jest.Mock>;
  let settings: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;

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

    lotsService = {
      prepareIncoming: jest.fn().mockReturnValue([]),
      addLots: jest.fn().mockResolvedValue([]),
      consume: jest.fn().mockResolvedValue([]),
      lottedQuantity: jest.fn().mockResolvedValue(0),
    };
    settings = { allowNegativeStock: jest.fn().mockResolvedValue(false) };
    autoPosting = { post: jest.fn().mockResolvedValue(null), preflight: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: getRepositoryToken(Stock), useValue: stockRepo },
        { provide: getRepositoryToken(StockMovement), useValue: movementRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(Warehouse), useValue: warehouseRepo },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: AutoPostingService, useValue: autoPosting },
        { provide: LotsService, useValue: lotsService },
        { provide: InventorySettingsService, useValue: settings },
        { provide: ProductsService, useValue: { toBaseQuantity: jest.fn() } },
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

  describe('issue (negative stock setting and lots)', () => {
    const goods = { id: 'prod-1', tenantId: 'tenant-1', code: 'P1', type: 'goods', costPrice: 10 };
    const req = { productId: 'prod-1', warehouseId: 'wh-1', quantity: 5, referenceType: 'sales_order' };

    it('rejects an issue beyond available stock when negative stock is not allowed', async () => {
      productRepo.findOne.mockResolvedValue(goods);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 3, reservedQty: 0 });

      await expect(service.issue('tenant-1', 'user-1', req)).rejects.toThrow(BadRequestException);
      expect(settings.allowNegativeStock).toHaveBeenCalledWith('tenant-1', 'wh-1');
      expect(stockRepo.save).not.toHaveBeenCalled();
    });

    it('lets stock go negative when the tenant allows it', async () => {
      settings.allowNegativeStock.mockResolvedValue(true);
      productRepo.findOne.mockResolvedValue(goods);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 3, reservedQty: 0 });
      stockRepo.save.mockImplementation((e) => e);

      const result = await service.issue('tenant-1', 'user-1', req);

      expect(stockRepo.save).toHaveBeenCalledWith(expect.objectContaining({ quantity: -2 }));
      expect(result.cost).toBe(50);
      expect(lotsService.consume).toHaveBeenCalledWith(
        expect.objectContaining({ warehouseId: 'wh-1' }),
        goods,
        5,
        expect.objectContaining({ allowShortage: true, onHand: 3, includeExpired: false }),
      );
    });

    it('returns the lots consumed and records the requested movement type', async () => {
      productRepo.findOne.mockResolvedValue(goods);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 10, reservedQty: 0 });
      lotsService.consume.mockResolvedValue([{ lotNumber: 'L1', quantity: 5, expiryDate: '2030-01-01' }]);

      const result = await service.issue('tenant-1', 'user-1', req, {
        movementType: StockMovementType.TRANSFER,
        includeExpiredLots: true,
      });

      expect(result.lots).toEqual([{ lotNumber: 'L1', quantity: 5, expiryDate: '2030-01-01' }]);
      expect(movementRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: StockMovementType.TRANSFER, quantity: -5 }),
      );
      expect(settings.allowNegativeStock).not.toHaveBeenCalled();
    });
  });

  describe('receive (lots)', () => {
    const tracked = { id: 'prod-1', tenantId: 'tenant-1', code: 'P1', type: 'goods', costPrice: 0, trackingType: 'lot' };

    beforeEach(() => {
      productRepo.findOne.mockResolvedValue({ ...tracked });
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.find.mockResolvedValue([]);
      stockRepo.findOne.mockResolvedValue(null);
      (productRepo as any).save = jest.fn((e) => e);
    });

    it('auto-names the lot after the reference on the generic path', async () => {
      await service.receive('tenant-1', 'user-1', {
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 4,
        unitCost: 3,
        referenceType: 'purchase_order',
        description: 'Receipt PO-000012',
      });

      expect(lotsService.prepareIncoming).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'prod-1' }),
        4,
        undefined,
        { strict: false, fallbackName: 'PO-000012' },
      );
      expect(lotsService.addLots).toHaveBeenCalled();
    });

    it('uses strict lot validation for the explicit receipt API and posts the receipt', async () => {
      await service.manualReceipt('tenant-1', 'user-1', {
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantity: 2,
        unitCost: 5,
        lots: [{ lotNumber: 'B1', quantity: 2, expiryDate: '2031-01-01' }],
      });

      expect(lotsService.prepareIncoming).toHaveBeenCalledWith(
        expect.anything(),
        2,
        [{ lotNumber: 'B1', quantity: 2, expiryDate: '2031-01-01' }],
        expect.objectContaining({ strict: true }),
      );
      expect(autoPosting.post).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'stock_receipt' }));
    });

    it('skips AVCO and lot validation when lot allocations are given (transfer receipt)', async () => {
      const allocations = [{ lotNumber: 'L1', quantity: 1, expiryDate: null }];
      await service.receive(
        'tenant-1',
        'user-1',
        { productId: 'prod-1', warehouseId: 'wh-1', quantity: 2, unitCost: 3, referenceType: 'stock_transfer' },
        { lotAllocations: allocations, movementType: StockMovementType.TRANSFER },
      );
      expect(lotsService.prepareIncoming).not.toHaveBeenCalled();
      expect(lotsService.addLots).toHaveBeenCalledWith(expect.anything(), expect.anything(), allocations, 3);
    });
  });

  describe('adjust (untracked part only)', () => {
    it('rejects reducing more than the stock not covered by lots', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'prod-1', code: 'P1', type: 'goods', costPrice: 1 });
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 10, reservedQty: 0 });
      lotsService.lottedQuantity.mockResolvedValue(8);

      await expect(
        service.adjust('tenant-1', 'user-1', { productId: 'prod-1', warehouseId: 'wh-1', quantity: -3 }, { untrackedOnly: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not post when post=false', async () => {
      productRepo.findOne.mockResolvedValue({ id: 'prod-1', code: 'P1', type: 'goods', costPrice: 2 });
      warehouseRepo.findOne.mockResolvedValue(mockWarehouse);
      stockRepo.findOne.mockResolvedValue({ ...mockStock, quantity: 10, reservedQty: 0 });

      await service.adjust('tenant-1', 'user-1', { productId: 'prod-1', warehouseId: 'wh-1', quantity: -3 }, { post: false });
      expect(autoPosting.post).not.toHaveBeenCalled();
      expect(lotsService.consume).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        3,
        expect.objectContaining({ includeExpired: true }),
      );
    });
  });
});
