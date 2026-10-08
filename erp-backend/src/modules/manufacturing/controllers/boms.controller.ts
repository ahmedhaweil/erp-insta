import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { BomsService } from '../services/boms.service';
import { BomExplodeQueryDto, BomQuantityQueryDto, CreateBomDto, UpdateBomDto } from '../dto/bom.dto';

const read = { module: 'manufacturing', screen: 'boms', action: 'read' };

@ApiTags('manufacturing')
@ApiBearerAuth()
@Controller('manufacturing/boms')
export class BomsController {
  constructor(private readonly bomsService: BomsService) {}

  @RequirePermissions({ module: 'manufacturing', screen: 'boms', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateBomDto,
  ) {
    return this.bomsService.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(read)
  @Get()
  @ApiQuery({ name: 'productId', required: false })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('productId') productId?: string,
    @Query('active') active?: string,
  ) {
    return this.bomsService.findAll(tenantId, productId, active === 'true');
  }

  @RequirePermissions(read)
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.bomsService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'manufacturing', screen: 'boms', action: 'update' })
  @Patch(':id')
  update(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateBomDto) {
    return this.bomsService.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'manufacturing', screen: 'boms', action: 'update' })
  @Post(':id/activate')
  activate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.bomsService.activate(tenantId, id);
  }

  @RequirePermissions({ module: 'manufacturing', screen: 'boms', action: 'update' })
  @Post(':id/deactivate')
  deactivate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.bomsService.deactivate(tenantId, id);
  }

  @RequirePermissions({ module: 'manufacturing', screen: 'boms', action: 'create' })
  @Post(':id/new-version')
  @ApiOperation({ summary: 'Copy the BOM into a new version' })
  @ApiQuery({ name: 'activate', required: false, type: Boolean })
  newVersion(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('activate') activate?: string,
  ) {
    return this.bomsService.newVersion(tenantId, user.sub, id, activate === 'true');
  }

  @RequirePermissions({ module: 'manufacturing', screen: 'boms', action: 'delete' })
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.bomsService.remove(tenantId, id);
  }

  @RequirePermissions(read)
  @Get(':id/explode')
  @ApiOperation({ summary: 'Multi-level BOM explosion for a quantity' })
  explode(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query() query: BomExplodeQueryDto,
  ) {
    return this.bomsService.explodeById(tenantId, id, query.quantity, query.multiLevel ?? true);
  }

  @RequirePermissions(read)
  @Get(':id/cost')
  @ApiOperation({ summary: 'BOM cost roll-up at current component costs' })
  cost(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query() query: BomQuantityQueryDto,
  ) {
    return this.bomsService.costRollup(tenantId, id, query.quantity);
  }
}
