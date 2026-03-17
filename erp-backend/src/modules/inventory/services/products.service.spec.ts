import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from '../entities/product.entity';

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepo: Record<string, jest.Mock>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: productRepo },
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
});
