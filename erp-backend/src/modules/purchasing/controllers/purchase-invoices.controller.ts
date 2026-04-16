import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PurchaseInvoicesService } from '../services/purchase-invoices.service';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/invoices')
export class PurchaseInvoicesController {
  constructor(private readonly invoicesService: PurchaseInvoicesService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'invoices', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseInvoiceDto,
  ) {
    return this.invoicesService.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'invoices', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.invoicesService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'invoices', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.invoicesService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'invoices', action: 'update' })
  @Post(':id/approve')
  approve(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.invoicesService.approve(tenantId, id);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'invoices', action: 'update' })
  @Post(':id/pay')
  markPaid(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.invoicesService.markPaid(tenantId, id);
  }
}
