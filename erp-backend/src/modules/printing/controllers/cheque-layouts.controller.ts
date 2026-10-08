import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { ChequeLayoutsService } from '../services/cheque-layouts.service';
import { CreateChequeLayoutDto, UpdateChequeLayoutDto } from '../dto/print.dto';

/** Cheque print layouts per bank (field positions in mm). */
@ApiTags('printing')
@ApiBearerAuth()
@Controller('print/cheque-layouts')
export class ChequeLayoutsController {
  constructor(private readonly layouts: ChequeLayoutsService) {}

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.layouts.findAll(tenantId);
  }

  @ApiOperation({ summary: 'Built-in default layout (template for new layouts)' })
  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'read' })
  @Get('defaults')
  defaults() {
    return this.layouts.defaults();
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.layouts.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateChequeLayoutDto) {
    return this.layouts.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Put(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChequeLayoutDto,
  ) {
    return this.layouts.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'update' })
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.layouts.remove(tenantId, id);
  }
}
