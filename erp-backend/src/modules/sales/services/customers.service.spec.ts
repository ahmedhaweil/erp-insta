import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { Customer } from '../entities/customer.entity';

describe('CustomersService', () => {
  let service: CustomersService;
  let customerRepo: Record<string, jest.Mock>;

  const mockCustomer = {
    id: 'cust-1',
    name: 'John Doe',
    email: 'john@example.com',
    tenantId: 'tenant-1',
  };

  beforeEach(async () => {
    customerRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'cust-1', ...entity })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  describe('create', () => {
    const createDto = { name: 'Jane Smith', email: 'jane@example.com' } as any;

    it('should create a new customer', async () => {
      const result = await service.create('tenant-1', createDto);

      expect(customerRepo.create).toHaveBeenCalledWith({ ...createDto, tenantId: 'tenant-1' });
      expect(customerRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });
  });

  describe('findAll', () => {
    it('should return all customers for a tenant', async () => {
      customerRepo.find.mockResolvedValue([mockCustomer]);

      const result = await service.findAll('tenant-1');

      expect(customerRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return a customer by id', async () => {
      customerRepo.findOne.mockResolvedValue(mockCustomer);

      const result = await service.findById('tenant-1', 'cust-1');

      expect(result).toEqual(mockCustomer);
    });

    it('should throw NotFoundException if customer not found', async () => {
      customerRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the customer', async () => {
      customerRepo.findOne.mockResolvedValue({ ...mockCustomer });

      const result = await service.update('tenant-1', 'cust-1', { name: 'Updated Name' } as any);

      expect(customerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Name' }),
      );
    });

    it('should throw NotFoundException if customer to update not found', async () => {
      customerRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('tenant-1', 'missing', { name: 'X' } as any),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
