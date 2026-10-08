import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SalesReturnsService } from '../services/sales-returns.service';
import { CreateSalesReturnDto } from '../dto/sales-return.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/returns')
export class SalesReturnsController {
  constructor(private readonly returns: SalesReturnsService) {}

  @RequirePermissions({ module: 'sales', screen: 'returns', action: 'create' })
  @Post()
  @ApiOperation({
    summary: 'Create a sales return against a posted invoice, or a cash return with explicit prices',
  })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalesReturnDto,
  ) {
    return this.returns.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'returns', action: 'read' })
  @Get()
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'invoiceId', required: false })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('customerId') customerId?: string,
    @Query('invoiceId') invoiceId?: string,
  ) {
    return this.returns.findAll(tenantId, { customerId, invoiceId });
  }

  @RequirePermissions({ module: 'sales', screen: 'returns', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.returns.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'returns', action: 'update' })
  @Post(':id/post')
  @ApiOperation({ summary: 'Restock the goods and issue (and post) the credit note' })
  post(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.returns.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'returns', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.returns.cancel(tenantId, id);
  }
}
