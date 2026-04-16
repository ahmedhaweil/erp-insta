import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TaxService } from '../services/tax.service';
import { EInvoiceService } from '../services/e-invoice.service';
import { CreateTaxConfigDto } from '../dto/create-tax-config.dto';
import { SubmitInvoiceDto } from '../dto/submit-invoice.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance')
export class ComplianceController {
  constructor(
    private readonly taxService: TaxService,
    private readonly eInvoiceService: EInvoiceService,
  ) {}

  @RequirePermissions({ module: 'compliance', screen: 'tax-configs', action: 'read' })
  @Get('tax-configs')
  getTaxConfigs(@CurrentTenant() tenantId: string) {
    return this.taxService.getTaxConfigs(tenantId);
  }

  @RequirePermissions({ module: 'compliance', screen: 'tax-configs', action: 'create' })
  @Post('tax-configs')
  createTaxConfig(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateTaxConfigDto,
  ) {
    return this.taxService.createTaxConfig(tenantId, dto);
  }

  @RequirePermissions({ module: 'compliance', screen: 'e-invoices', action: 'create' })
  @Post('e-invoices/submit')
  submitInvoice(
    @CurrentTenant() tenantId: string,
    @Body() dto: SubmitInvoiceDto,
  ) {
    return this.eInvoiceService.submitInvoice(tenantId, dto);
  }

  @RequirePermissions({ module: 'compliance', screen: 'e-invoices', action: 'read' })
  @Get('e-invoices')
  getEInvoices(@CurrentTenant() tenantId: string) {
    return this.eInvoiceService.findAll(tenantId);
  }
}
