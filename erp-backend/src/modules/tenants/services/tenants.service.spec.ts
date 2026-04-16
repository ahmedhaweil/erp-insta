import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Tenant } from '../entities/tenant.entity';

describe('TenantsService', () => {
  let service: TenantsService;
  let tenantRepo: Record<string, jest.Mock>;

  const mockTenant = {
    id: 'tenant-1',
    slug: 'acme',
    name: 'Acme Corp',
    plan: 'starter',
    isActive: true,
    country: 'EG',
  };

  beforeEach(async () => {
    tenantRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'tenant-1', ...entity })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
      ],
    }).compile();

    service = module.get<TenantsService>(TenantsService);
  });

  describe('create', () => {
    const createDto = { slug: 'newco', name: 'New Company', country: 'SA' };

    it('should create a new tenant', async () => {
      tenantRepo.findOne.mockResolvedValue(null);

      const result = await service.create(createDto);

      expect(tenantRepo.create).toHaveBeenCalledWith(createDto);
      expect(tenantRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('slug', 'newco');
    });

    it('should throw ConflictException if slug already exists', async () => {
      tenantRepo.findOne.mockResolvedValue(mockTenant);

      await expect(service.create(createDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('findAll', () => {
    it('should return only active tenants', async () => {
      tenantRepo.find.mockResolvedValue([mockTenant]);

      const result = await service.findAll();

      expect(tenantRepo.find).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return a tenant by id', async () => {
      tenantRepo.findOne.mockResolvedValue(mockTenant);

      const result = await service.findById('tenant-1');

      expect(result).toEqual(mockTenant);
    });

    it('should throw NotFoundException if tenant not found', async () => {
      tenantRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findBySlug', () => {
    it('should return a tenant by slug', async () => {
      tenantRepo.findOne.mockResolvedValue(mockTenant);

      const result = await service.findBySlug('acme');

      expect(result).toEqual(mockTenant);
    });

    it('should throw NotFoundException if slug not found', async () => {
      tenantRepo.findOne.mockResolvedValue(null);

      await expect(service.findBySlug('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the tenant', async () => {
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });

      const result = await service.update('tenant-1', { name: 'Updated Name' });

      expect(tenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Name' }),
      );
    });
  });

  describe('deactivate', () => {
    it('should set isActive to false', async () => {
      tenantRepo.findOne.mockResolvedValue({ ...mockTenant });

      const result = await service.deactivate('tenant-1');

      expect(tenantRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });
});
