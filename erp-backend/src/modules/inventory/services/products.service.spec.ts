import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from '../entities/product.entity';
import { ProductUnit } from '../entities/product-unit.entity';
import { Unit } from '../entities/unit.entity';

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepo: Record<string, jest.Mock>;
  let productUnitRepo: Record<string, jest.Mock>;
  let unitRepo: Record<string, jest.Mock>;

  const mockProduct = {
    id: 'prod-1',
    code: 'SKU-001',
    nameEn: 'Widget',
    tenantId: 'tenant-1',
    category: { id: 'cat-1' },
    unit: { id: 'unit-1' },
  };

  beforeEach(async () => {
    productRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'prod-1', ...entity })),
    };

    productUnitRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'pu-1', ...entity })),
      remove: jest.fn(),
    };
    unitRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(ProductUnit), useValue: productUnitRepo },
        { provide: getRepositoryToken(Unit), useValue: unitRepo },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
  });

  describe('create', () => {
    const createDto = { code: 'SKU-002', nameEn: 'Gadget' } as any;

    it('should create a new product', async () => {
      const result = await service.create('tenant-1', createDto);

      expect(productRepo.create).toHaveBeenCalledWith({ ...createDto, tenantId: 'tenant-1' });
      expect(productRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });
  });

  describe('findAll', () => {
    it('should return all products for a tenant', async () => {
      productRepo.find.mockResolvedValue([mockProduct]);

      const result = await service.findAll('tenant-1');

      expect(productRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        order: { code: 'ASC' },
        relations: ['category', 'unit'],
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return a product by id', async () => {
      productRepo.findOne.mockResolvedValue(mockProduct);

      const result = await service.findById('tenant-1', 'prod-1');

      expect(result).toEqual(mockProduct);
    });

    it('should throw NotFoundException if product not found', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the product', async () => {
      productRepo.findOne.mockResolvedValue({ ...mockProduct });

      const result = await service.update('tenant-1', 'prod-1', { nameEn: 'Updated Widget' } as any);

      expect(productRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ nameEn: 'Updated Widget' }),
      );
    });

    it('should throw NotFoundException if product to update not found', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('tenant-1', 'missing', { nameEn: 'X' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('tracking flags', () => {
    it('rejects expiry dates without lot/serial tracking', async () => {
      await expect(service.create('tenant-1', { code: 'X', hasExpiry: true } as any)).rejects.toThrow(
        'Expiry dates require lot or serial tracking',
      );
    });
  });

  describe('units of measure', () => {
    const product = { id: 'prod-1', code: 'P', unitId: 'piece', sellPrice: 2, tenantId: 'tenant-1' };

    it('converts alternate-unit quantities to the base unit', async () => {
      productRepo.findOne.mockResolvedValue(product);
      productUnitRepo.findOne.mockResolvedValue({ factor: '12.000000' });

      expect(await service.toBaseQuantity('tenant-1', 'prod-1', 2, 'carton')).toBe(24);
      expect(await service.toBaseQuantity('tenant-1', 'prod-1', 5, 'piece')).toBe(5);
      expect(await service.toBaseQuantity('tenant-1', 'prod-1', 5)).toBe(5);
    });

    it('falls back to the global unit conversion and rejects unknown units', async () => {
      productRepo.findOne.mockResolvedValue(product);
      productUnitRepo.findOne.mockResolvedValue(null);
      unitRepo.findOne.mockResolvedValueOnce({ id: 'dozen', baseUnitId: 'piece', conversionFactor: '12' });
      expect(await service.toBaseQuantity('tenant-1', 'prod-1', 1, 'dozen')).toBe(12);

      unitRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.toBaseQuantity('tenant-1', 'prod-1', 1, 'kg')).rejects.toThrow(BadRequestException);
    });

    it('rejects a barcode already used by a product', async () => {
      productRepo.findOne
        .mockResolvedValueOnce(product) // findById
        .mockResolvedValueOnce({ id: 'other' }); // barcode owner
      unitRepo.findOne.mockResolvedValue({ id: 'carton' });

      await expect(
        service.upsertUnit('tenant-1', 'prod-1', { unitId: 'carton', factor: 12, barcode: '123' }),
      ).rejects.toThrow(ConflictException);
    });

    it('cannot add the base unit as an alternate unit', async () => {
      productRepo.findOne.mockResolvedValue(product);
      await expect(service.upsertUnit('tenant-1', 'prod-1', { unitId: 'piece', factor: 1 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('lookupBarcode', () => {
    it('returns the base unit for a product barcode', async () => {
      productRepo.findOne.mockResolvedValueOnce({ id: 'prod-1', unitId: 'piece', sellPrice: '2.5', unit: { nameEn: 'Piece' } });
      const result = await service.lookupBarcode('tenant-1', '111');
      expect(result).toEqual(expect.objectContaining({ unitId: 'piece', factor: 1, price: 2.5, unitName: 'Piece' }));
    });

    it('returns the alternate unit, factor and default price for a unit barcode', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);
      productUnitRepo.findOne.mockResolvedValueOnce({
        id: 'pu-1',
        unitId: 'carton',
        factor: '12',
        sellPrice: null,
        unit: { nameEn: 'Carton' },
        product: { id: 'prod-1', sellPrice: '2.5' },
      });
      const result = await service.lookupBarcode('tenant-1', '222');
      expect(result).toEqual(
        expect.objectContaining({ unitId: 'carton', factor: 12, price: 30, productUnitId: 'pu-1' }),
      );
    });

    it('uses the unit sell price when set and 404s on unknown codes', async () => {
      productRepo.findOne.mockResolvedValueOnce(null);
      productUnitRepo.findOne.mockResolvedValueOnce({
        id: 'pu-1',
        unitId: 'carton',
        factor: '12',
        sellPrice: '27',
        product: { id: 'prod-1', sellPrice: '2.5' },
      });
      expect((await service.lookupBarcode('tenant-1', '222')).price).toBe(27);

      productRepo.findOne.mockResolvedValue(null);
      productUnitRepo.findOne.mockResolvedValue(null);
      await expect(service.lookupBarcode('tenant-1', 'nope')).rejects.toThrow(NotFoundException);
    });
  });
});
