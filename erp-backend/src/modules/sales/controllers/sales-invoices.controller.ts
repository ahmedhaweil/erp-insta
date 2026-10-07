import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { SalesInvoicesService } from '../services/sales-invoices.service';
import { CreateSalesInvoiceDto } from '../dto/create-sales-invoice.dto';
import { CreateCreditNoteDto } from '../dto/sales-actions.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/invoices')
export class SalesInvoicesController {
  constructor(private readonly salesInvoicesService: SalesInvoicesService) {}

  @RequirePermissions({ module: 'sales', screen: 'invoices', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalesInvoiceDto,
  ) {
    return this.salesInvoicesService.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'invoices', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.salesInvoicesService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'sales', screen: 'invoices', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.salesInvoicesService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'invoices', action: 'update' })
  @Post(':id/pay')
  markPaid(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.salesInvoicesService.markPaid(tenantId, id, user.sub);
  }

  @RequirePermissions({ module: 'sales', screen: 'invoices', action: 'update' })
  @Post(':id/post')
  post(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.salesInvoicesService.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'invoices', action: 'update' })
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.salesInvoicesService.cancel(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'invoices', action: 'create' })
  @Post(':id/credit-note')
  createCreditNote(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.salesInvoicesService.createCreditNote(tenantId, user.sub, id, dto);
  }
}
