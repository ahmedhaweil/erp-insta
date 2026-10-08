import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchasingSettings } from '../entities/purchasing-settings.entity';
import { UpdatePurchasingSettingsDto } from '../dto/purchasing-settings.dto';

@Injectable()
export class PurchasingSettingsService {
  constructor(
    @InjectRepository(PurchasingSettings)
    private readonly settingsRepo: Repository<PurchasingSettings>,
  ) {}

  /** Tenant settings, or the defaults (no approval threshold) when none were saved. */
  async get(tenantId: string): Promise<PurchasingSettings> {
    const found = await this.settingsRepo.findOne({ where: { tenantId } });
    return (
      found ??
      this.settingsRepo.create({ tenantId, poApprovalThreshold: 0, requisitionApprovalRequired: true })
    );
  }

  async update(tenantId: string, dto: UpdatePurchasingSettingsDto): Promise<PurchasingSettings> {
    const settings = await this.get(tenantId);
    Object.assign(settings, dto);
    return this.settingsRepo.save(settings);
  }
}
