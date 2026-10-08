import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EInvoiceService } from '../services/e-invoice.service';
import { ListComplianceDocumentsDto, ReasonDto, SubmitInvoiceDto } from '../dto/submit-invoice.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance/e-invoices')
export class EInvoicesController {
  constructor(private readonly eInvoices: EInvoiceService) {}

  @ApiOperation({ summary: 'List e-invoices (filters: provider, status, from, to, search)' })
  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'read' })
  @Get()
  list(@CurrentTenant() tenantId: string, @Query() query: ListComplianceDocumentsDto) {
    return this.eInvoices.findAll(tenantId, query);
  }

  @ApiOperation({ summary: 'Submit a posted invoice / credit note to ETA or ZATCA (by tenant country)' })
  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'create' })
  @Post('submit')
  submit(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: SubmitInvoiceDto) {
    return this.eInvoices.submitInvoice(tenantId, dto, user?.sub ?? null);
  }

  @ApiOperation({ summary: 'Build the ETA JSON / ZATCA XML of an invoice without submitting it' })
  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'read' })
  @Get('preview/:invoiceId')
  preview(@CurrentTenant() tenantId: string, @Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.eInvoices.preview(tenantId, invoiceId);
  }

  @ApiOperation({ summary: 'Poll ETA for every document still in submitted state' })
  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'update' })
  @Post('refresh-pending')
  refreshPending(@CurrentTenant() tenantId: string) {
    return this.eInvoices.refreshPending(tenantId);
  }

  @ApiOperation({ summary: 'Reject (as receiver) an ETA document issued to this taxpayer' })
  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'update' })
  @Post('received/:uuid/reject')
  rejectReceived(@CurrentTenant() tenantId: string, @Param('uuid') uuid: string, @Body() dto: ReasonDto) {
    return this.eInvoices.rejectReceived(tenantId, uuid, dto.reason);
  }

  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'read' })
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.eInvoices.getStatus(tenantId, id);
  }

  @ApiOperation({ summary: 'Refresh the status from the tax authority' })
  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'update' })
  @Post(':id/refresh')
  refresh(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.eInvoices.refreshStatus(tenantId, id);
  }

  @ApiOperation({ summary: 'Cancel a valid ETA document' })
  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.eInvoices.cancel(tenantId, id, dto.reason);
  }

  @ApiOperation({ summary: 'QR content / ETA print URL' })
  @RequirePermissions({ module: 'compliance', screen: 'e_invoices', action: 'read' })
  @Get(':id/qr')
  qr(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.eInvoices.getQr(tenantId, id);
  }
}
