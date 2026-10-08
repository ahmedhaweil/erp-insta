import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { LandedCostsService } from '../services/landed-costs.service';
import { CreateLandedCostDto } from '../dto/landed-cost.dto';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/landed-costs')
export class LandedCostsController {
  constructor(private readonly landedCosts: LandedCostsService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'landed_costs', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.landedCosts.findAll(tenantId);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'landed_costs', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.landedCosts.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'landed_costs', action: 'read' })
  @Get(':id/preview')
  preview(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.landedCosts.preview(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'landed_costs', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateLandedCostDto) {
    return this.landedCosts.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'landed_costs', action: 'update' })
  @Post(':id/post')
  post(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.landedCosts.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'landed_costs', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.landedCosts.cancel(tenantId, user.sub, id);
  }
}
