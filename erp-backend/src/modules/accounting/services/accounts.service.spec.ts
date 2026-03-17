import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { Account, AccountType } from '../entities/account.entity';

describe('AccountsService', () => {
  let service: AccountsService;
  let accountRepo: Record<string, jest.Mock>;

  const mockAccount = {
    id: 'acc-1',
    code: '1000',
    nameAr: 'أصول',
    nameEn: 'Assets',
    type: AccountType.ASSET,
    tenantId: 'tenant-1',
    parentId: null,
    level: 0,
    isActive: true,
    children: [],
  };

  beforeEach(async () => {
    accountRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((entity) => ({ id: 'acc-new', ...entity })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: getRepositoryToken(Account), useValue: accountRepo },
      ],
    }).compile();

    service = module.get<AccountsService>(AccountsService);
  });

  describe('create', () => {
    const createDto = {
      code: '1100',
      nameAr: 'نقدية',
      nameEn: 'Cash',
      type: AccountType.ASSET,
    };

    it('should create a root account with level 0', async () => {
      const result = await service.create('tenant-1', createDto);

      expect(accountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1', level: 0 }),
      );
      expect(accountRepo.save).toHaveBeenCalled();
    });

    it('should create a child account with parent level + 1', async () => {
      const parentAccount = { ...mockAccount, level: 2 };
      accountRepo.findOne.mockResolvedValue(parentAccount);

      const result = await service.create('tenant-1', { ...createDto, parentId: 'acc-1' });

      expect(accountRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ level: 3 }),
      );
    });

    it('should throw NotFoundException if parent not found', async () => {
      accountRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create('tenant-1', { ...createDto, parentId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return all accounts for tenant sorted by code', async () => {
      accountRepo.find.mockResolvedValue([mockAccount]);

      const result = await service.findAll('tenant-1');

      expect(accountRepo.find).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        order: { code: 'ASC' },
        relations: ['children'],
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return an account by id', async () => {
      accountRepo.findOne.mockResolvedValue(mockAccount);

      const result = await service.findById('tenant-1', 'acc-1');

      expect(result).toEqual(mockAccount);
    });

    it('should throw NotFoundException if account not found', async () => {
      accountRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return the account', async () => {
      accountRepo.findOne.mockResolvedValue({ ...mockAccount });

      const result = await service.update('tenant-1', 'acc-1', { nameEn: 'Updated Assets' });

      expect(accountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ nameEn: 'Updated Assets' }),
      );
    });
  });
});
