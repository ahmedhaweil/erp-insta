import { Controller, Get, Post, Body, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EReceiptService } from '../services/e-receipt.service';
import { ListComplianceDocumentsDto, SubmitReceiptDto } from '../dto/submit-invoice.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('compliance')
@ApiBearerAuth()
@Controller('compliance/e-receipts')
export class EReceiptsController {
  constructor(private readonly receipts: EReceiptService) {}

  @RequirePermissions({ module: 'compliance', screen: 'e_receipts', action: 'read' })
  @Get()
  list(@CurrentTenant() tenantId: string, @Query() query: ListComplianceDocumentsDto) {
    return this.receipts.findAll(tenantId, query);
  }

  @ApiOperation({ summary: 'Submit the ETA e-receipt of a POS order (sale or return)' })
  @RequirePermissions({ module: 'compliance', screen: 'e_receipts', action: 'create' })
  @Post('submit')
  submit(@CurrentTenant() tenantId: string, @Body() dto: SubmitReceiptDto) {
    return this.receipts.submit(tenantId, dto.posOrderId);
  }

  @ApiOperation({ summary: 'Build the e-receipt JSON and QR of a POS order without submitting it' })
  @RequirePermissions({ module: 'compliance', screen: 'e_receipts', action: 'read' })
  @Get('preview/:posOrderId')
  preview(@CurrentTenant() tenantId: string, @Param('posOrderId', ParseUUIDPipe) posOrderId: string) {
    return this.receipts.preview(tenantId, posOrderId);
  }

  @RequirePermissions({ module: 'compliance', screen: 'e_receipts', action: 'read' })
  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'compliance', screen: 'e_receipts', action: 'update' })
  @Post(':id/refresh')
  refresh(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.refresh(tenantId, id);
  }

  @RequirePermissions({ module: 'compliance', screen: 'e_receipts', action: 'read' })
  @Get(':id/qr')
  qr(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.getQr(tenantId, id);
  }
}
