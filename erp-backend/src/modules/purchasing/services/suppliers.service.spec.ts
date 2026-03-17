import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { Supplier } from '../entities/supplier.entity';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let supplierRepo: Record<string, jest.Mock>;

  const mockSupplier = {
    id: 'supplier-1',
    tenantId: 'tenant-1',
    code: 'SUP-001',
    nameEn: 'Test Supplier',
    nameAr: 'مورد تجريبي',
    email: 'supplier@example.com',
  };

  beforeEach(async () => {
    supplierRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'supplier-1', ...entity })),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: getRepositoryToken(Supplier), useValue: supplierRepo },
      ],
    }).compile();

    service = module.get<SuppliersService>(SuppliersService);
  });

  describe('create', () => {
    const createDto = { code: 'SUP-002', nameEn: 'New Supplier' };

    it('should create a new supplier', async () => {
      supplierRepo.findOne.mockResolvedValue(null);

      const result = await service.create('tenant-1', createDto as any);

      expect(supplierRepo.create).toHaveBeenCalledWith({ ...createDto, tenantId: 'tenant-1' });
      expect(supplierRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });

    it('should throw ConflictException if supplier code already exists', async () => {
      supplierRepo.findOne.mockResolvedValue(mockSupplier);

      await expect(service.create('tenant-1', createDto as any)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all suppliers for the tenant', async () => {
      supplierRepo.find.mockResolvedValue([mockSupplier]);

      const result = await service.findAll('tenant-1');

      expect(supplierRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return a supplier by id', async () => {
      supplierRepo.findOne.mockResolvedValue(mockSupplier);

      const result = await service.findById('tenant-1', 'supplier-1');

      expect(result).toEqual(mockSupplier);
    });

    it('should throw NotFoundException if supplier not found', async () => {
      supplierRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the supplier', async () => {
      supplierRepo.findOne.mockResolvedValue({ ...mockSupplier });

      const result = await service.update('tenant-1', 'supplier-1', { nameEn: 'Updated Supplier' } as any);

      expect(supplierRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ nameEn: 'Updated Supplier' }),
      );
    });

    it('should throw NotFoundException if supplier to update not found', async () => {
      supplierRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('tenant-1', 'missing', { nameEn: 'Updated' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should remove the supplier', async () => {
      supplierRepo.findOne.mockResolvedValue(mockSupplier);

      await service.remove('tenant-1', 'supplier-1');

      expect(supplierRepo.remove).toHaveBeenCalledWith(mockSupplier);
    });

    it('should throw NotFoundException if supplier to remove not found', async () => {
      supplierRepo.findOne.mockResolvedValue(null);

      await expect(service.remove('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
