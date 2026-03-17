import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../entities/account.entity';
import { CreateAccountDto } from '../dto/create-account.dto';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  async create(tenantId: string, dto: CreateAccountDto): Promise<Account> {
    let level = 0;
    if (dto.parentId) {
      const parent = await this.accountRepo.findOne({
        where: { id: dto.parentId, tenantId },
      });
      if (!parent) throw new NotFoundException('Parent account not found');
      level = parent.level + 1;
    }

    const account = this.accountRepo.create({ ...dto, tenantId, level });
    return this.accountRepo.save(account);
  }

  async findAll(tenantId: string): Promise<Account[]> {
    return this.accountRepo.find({
      where: { tenantId },
      order: { code: 'ASC' },
      relations: ['children'],
    });
  }

  async findTree(tenantId: string): Promise<Account[]> {
    const accounts = await this.accountRepo.find({
      where: { tenantId, parentId: undefined },
      relations: ['children'],
      order: { code: 'ASC' },
    });
    return accounts;
  }

  async findById(tenantId: string, id: string): Promise<Account> {
    const account = await this.accountRepo.findOne({
      where: { id, tenantId },
      relations: ['children'],
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateAccountDto>): Promise<Account> {
    const account = await this.findById(tenantId, id);
    Object.assign(account, dto);
    return this.accountRepo.save(account);
  }
}
