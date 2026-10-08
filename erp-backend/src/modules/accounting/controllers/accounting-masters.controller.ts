import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { Journal } from '../entities/journal.entity';
import { CostCenter } from '../entities/cost-center.entity';
import { Currency } from '../entities/currency.entity';
import { ExchangeRate } from '../entities/exchange-rate.entity';
import { Account } from '../entities/account.entity';
import {
  CreateCostCenterDto,
  CreateExchangeRateDto,
  CreateJournalDto,
  UpdateCostCenterDto,
} from '../dto/accounting-masters.dto';

/** Accounting master data used by entry forms: journals, cost centers, currencies and rates. */
@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting')
export class AccountingMastersController {
  constructor(
    @InjectRepository(Journal) private readonly journalRepo: Repository<Journal>,
    @InjectRepository(CostCenter) private readonly costCenterRepo: Repository<CostCenter>,
    @InjectRepository(Currency) private readonly currencyRepo: Repository<Currency>,
    @InjectRepository(ExchangeRate) private readonly rateRepo: Repository<ExchangeRate>,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
  ) {}

  @RequirePermissions({ module: 'accounting', screen: 'journals', action: 'read' })
  @Get('journals')
  journals(@CurrentTenant() tenantId: string) {
    return this.journalRepo.find({ where: { tenantId }, order: { type: 'ASC', name: 'ASC' } });
  }

  @RequirePermissions({ module: 'accounting', screen: 'journals', action: 'create' })
  @Post('journals')
  async createJournal(@CurrentTenant() tenantId: string, @Body() dto: CreateJournalDto) {
    if (dto.defaultAccountId) await this.assertAccount(tenantId, dto.defaultAccountId);
    return this.journalRepo.save(this.journalRepo.create({ ...dto, tenantId }));
  }

  @RequirePermissions({ module: 'accounting', screen: 'cost_centers', action: 'read' })
  @Get('cost-centers')
  costCenters(@CurrentTenant() tenantId: string) {
    return this.costCenterRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  @RequirePermissions({ module: 'accounting', screen: 'cost_centers', action: 'create' })
  @Post('cost-centers')
  async createCostCenter(@CurrentTenant() tenantId: string, @Body() dto: CreateCostCenterDto) {
    if (await this.costCenterRepo.findOne({ where: { tenantId, code: dto.code } })) {
      throw new ConflictException(`Cost center ${dto.code} already exists`);
    }
    if (dto.parentId) await this.loadCostCenter(tenantId, dto.parentId);
    return this.costCenterRepo.save(this.costCenterRepo.create({ ...dto, tenantId }));
  }

  @RequirePermissions({ module: 'accounting', screen: 'cost_centers', action: 'update' })
  @Patch('cost-centers/:id')
  async updateCostCenter(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCostCenterDto,
  ) {
    const costCenter = await this.loadCostCenter(tenantId, id);
    if (dto.parentId) {
      if (dto.parentId === id) throw new ConflictException('A cost center cannot be its own parent');
      await this.loadCostCenter(tenantId, dto.parentId);
    }
    if (dto.code && dto.code !== costCenter.code) {
      if (await this.costCenterRepo.findOne({ where: { tenantId, code: dto.code } })) {
        throw new ConflictException(`Cost center ${dto.code} already exists`);
      }
    }
    Object.assign(costCenter, dto);
    return this.costCenterRepo.save(costCenter);
  }

  @RequirePermissions({ module: 'accounting', screen: 'currencies', action: 'read' })
  @Get('currencies')
  currencies() {
    return this.currencyRepo.find({ order: { isBase: 'DESC', code: 'ASC' } });
  }

  /** The company's own rates plus shared default rates, newest first. */
  @RequirePermissions({ module: 'accounting', screen: 'currencies', action: 'read' })
  @Get('exchange-rates')
  @ApiQuery({ name: 'currencyId', required: false })
  exchangeRates(@CurrentTenant() tenantId: string, @Query('currencyId') currencyId?: string) {
    const qb = this.rateRepo
      .createQueryBuilder('r')
      .where(new Brackets((w) => w.where('r.tenantId = :tenantId', { tenantId }).orWhere('r.tenantId IS NULL')))
      .orderBy('r.date', 'DESC')
      .addOrderBy('r.createdAt', 'DESC')
      .take(500);
    if (currencyId) qb.andWhere('r.currencyId = :currencyId', { currencyId });
    return qb.getMany();
  }

  @RequirePermissions({ module: 'accounting', screen: 'currencies', action: 'create' })
  @Post('exchange-rates')
  async createExchangeRate(@CurrentTenant() tenantId: string, @Body() dto: CreateExchangeRateDto) {
    if (!(await this.currencyRepo.count({ where: { id: dto.currencyId } }))) {
      throw new NotFoundException('Currency not found');
    }
    return this.rateRepo.save(this.rateRepo.create({ ...dto, tenantId }));
  }

  private async loadCostCenter(tenantId: string, id: string) {
    const costCenter = await this.costCenterRepo.findOne({ where: { tenantId, id } });
    if (!costCenter) throw new NotFoundException('Cost center not found');
    return costCenter;
  }

  private async assertAccount(tenantId: string, id: string) {
    if (!(await this.accountRepo.count({ where: { tenantId, id } }))) {
      throw new NotFoundException('Account not found');
    }
  }
}
