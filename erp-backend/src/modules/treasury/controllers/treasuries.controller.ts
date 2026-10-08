import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { TreasuriesService } from '../services/treasuries.service';
import { CreateTreasuryDto, DateRangeQueryDto, UpdateTreasuryDto } from '../dto/treasury.dto';
import { TreasuryType } from '../entities/treasury.entity';

@ApiTags('treasury')
@ApiBearerAuth()
@Controller('treasury/treasuries')
export class TreasuriesController {
  constructor(private readonly treasuries: TreasuriesService) {}

  @RequirePermissions({ module: 'treasury', screen: 'treasuries', action: 'read' })
  @Get()
  @ApiQuery({ name: 'type', enum: TreasuryType, required: false })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  @ApiQuery({ name: 'withBalance', required: false, type: Boolean })
  @ApiQuery({
    name: 'usableOnly',
    required: false,
    type: Boolean,
    description: 'Only the treasuries the current user is custodian of (or all with treasury/treasuries/all)',
  })
  findAll(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query('type') type?: TreasuryType,
    @Query('activeOnly') activeOnly?: string,
    @Query('withBalance') withBalance?: string,
    @Query('usableOnly') usableOnly?: string,
  ) {
    return this.treasuries.findAll(tenantId, {
      type,
      activeOnly: activeOnly === 'true',
      withBalance: withBalance === 'true',
      usableBy: usableOnly === 'true' ? user.sub : undefined,
    });
  }

  @RequirePermissions({ module: 'treasury', screen: 'treasuries', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTreasuryDto,
  ) {
    return this.treasuries.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'treasuries', action: 'read' })
  @Get(':id')
  @ApiOperation({ summary: 'Treasury with its balance (treasury currency and base)' })
  @ApiQuery({ name: 'asOf', required: false })
  findById(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.treasuries.getWithBalance(tenantId, id, asOf);
  }

  @RequirePermissions({ module: 'treasury', screen: 'treasuries', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTreasuryDto,
  ) {
    return this.treasuries.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'treasuries', action: 'read' })
  @Get(':id/movements')
  @ApiOperation({ summary: 'Cash book / bank movements with opening and running balance' })
  movements(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.treasuries.movements(tenantId, id, query.from, query.to, user.sub);
  }
}
