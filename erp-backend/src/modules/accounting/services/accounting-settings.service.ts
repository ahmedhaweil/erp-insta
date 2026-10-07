import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccountingSettings } from '../entities/accounting-settings.entity';
import { Account } from '../entities/account.entity';
import { UpdateAccountingSettingsDto } from '../dto/update-accounting-settings.dto';

@Injectable()
export class AccountingSettingsService {
  constructor(
    @InjectRepository(AccountingSettings)
    private readonly settingsRepo: Repository<AccountingSettings>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  /** Returns null when the tenant has not configured automatic accounting. */
  async find(tenantId: string): Promise<AccountingSettings | null> {
    return this.settingsRepo.findOne({ where: { tenantId } });
  }

  async get(tenantId: string): Promise<AccountingSettings> {
    const settings = await this.find(tenantId);
    if (!settings) throw new NotFoundException('Accounting settings have not been configured');
    return settings;
  }

  async upsert(tenantId: string, dto: UpdateAccountingSettingsDto): Promise<AccountingSettings> {
    const accountIds = Object.entries(dto)
      .filter(([key, value]) => key.endsWith('AccountId') && value)
      .map(([, value]) => value as string);
    if (accountIds.length) {
      const unique = [...new Set(accountIds)];
      const found = await this.accountRepo.count({ where: { tenantId, id: In(unique) } });
      if (found !== unique.length) {
        throw new NotFoundException('One or more configured accounts do not exist');
      }
    }

    const existing = await this.find(tenantId);
    const settings = existing ?? this.settingsRepo.create({ tenantId });
    Object.assign(settings, dto);
    return this.settingsRepo.save(settings);
  }
}
