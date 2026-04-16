import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaxConfig, TaxCountry } from '../entities/tax-config.entity';
import { CreateTaxConfigDto } from '../dto/create-tax-config.dto';

@Injectable()
export class TaxService {
  constructor(
    @InjectRepository(TaxConfig)
    private readonly taxConfigRepo: Repository<TaxConfig>,
  ) {}

  async getTaxConfigs(tenantId: string): Promise<TaxConfig[]> {
    return this.taxConfigRepo.find({
      where: { tenantId },
      order: { country: 'ASC', taxType: 'ASC' },
    });
  }

  async createTaxConfig(
    tenantId: string,
    dto: CreateTaxConfigDto,
  ): Promise<TaxConfig> {
    const config = this.taxConfigRepo.create({ ...dto, tenantId });
    return this.taxConfigRepo.save(config);
  }

  async calculateTax(
    tenantId: string,
    amount: number,
    country: TaxCountry,
  ): Promise<{ taxAmount: number; configs: TaxConfig[] }> {
    const configs = await this.taxConfigRepo.find({
      where: { tenantId, country, isActive: true },
    });
    if (!configs.length) {
      throw new NotFoundException(`No active tax configs for country ${country}`);
    }

    const taxAmount = configs.reduce(
      (sum, config) => sum + amount * (Number(config.rate) / 100),
      0,
    );

    return { taxAmount, configs };
  }
}
