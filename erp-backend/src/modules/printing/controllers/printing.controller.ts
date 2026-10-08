import { Controller, Get, Param, ParseUUIDPipe, Query, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { PrintingService, RenderedPdf } from '../services/printing.service';
import {
  ChequePrintQueryDto,
  DeliveryNoteQueryDto,
  PrintQueryDto,
  SalesOrderPrintQueryDto,
  StatementPrintQueryDto,
} from '../dto/print.dto';
import { PdfFile } from '../pdf-file';

const pdf = (r: RenderedPdf, q: { disposition?: 'inline' | 'attachment' }) =>
  new PdfFile(r.buffer, r.filename, q.disposition ?? 'inline');

/**
 * Printable documents (application/pdf). Every endpoint accepts ?lang=ar|en
 * (default ar) and, where it makes sense, ?paper=a4|80mm. Access reuses the
 * read permission of the source document.
 */
@ApiTags('printing')
@ApiBearerAuth()
@ApiProduces('application/pdf')
@Controller('print')
export class PrintingController {
  constructor(private readonly printing: PrintingService) {}

  @ApiOperation({ summary: 'Sales tax invoice / credit note (ETA / ZATCA QR when available)' })
  @RequirePermissions({ module: 'sales', screen: 'invoices', action: 'read' })
  @Get('sales-invoices/:id')
  async salesInvoice(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PrintQueryDto) {
    return pdf(await this.printing.salesInvoice(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'Quotation / sales order' })
  @RequirePermissions({ module: 'sales', screen: 'orders', action: 'read' })
  @Get('sales-orders/:id')
  async salesOrder(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: SalesOrderPrintQueryDto,
  ) {
    return pdf(await this.printing.salesOrder(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'Delivery note of a sales order (no prices)' })
  @RequirePermissions({ module: 'sales', screen: 'orders', action: 'read' })
  @Get('sales-orders/:id/delivery-note')
  async deliveryNote(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: DeliveryNoteQueryDto,
  ) {
    return pdf(await this.printing.deliveryNote(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'Purchase order / RFQ' })
  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'read' })
  @Get('purchase-orders/:id')
  async purchaseOrder(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PrintQueryDto) {
    return pdf(await this.printing.purchaseOrder(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'Treasury receipt / payment voucher (سند قبض / صرف)' })
  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'read' })
  @Get('treasury-vouchers/:id')
  async treasuryVoucher(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PrintQueryDto,
  ) {
    return pdf(await this.printing.treasuryVoucher(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'Customer receipt / supplier payment voucher' })
  @RequirePermissions({ module: 'accounting', screen: 'payments', action: 'read' })
  @Get('payments/:id')
  async payment(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PrintQueryDto) {
    return pdf(await this.printing.payment(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'POS receipt (80mm by default; ?paper=a4)' })
  @RequirePermissions({ module: 'pos', screen: 'orders', action: 'read' })
  @Get('pos-orders/:id')
  async posReceipt(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PrintQueryDto) {
    return pdf(await this.printing.posReceipt(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'Payslip of one payroll line' })
  @RequirePermissions({ module: 'hr', screen: 'payroll', action: 'read' })
  @Get('payroll-lines/:id/payslip')
  async payslip(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PrintQueryDto) {
    return pdf(await this.printing.payslip(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'All payslips of a payroll run in one PDF' })
  @RequirePermissions({ module: 'hr', screen: 'payroll', action: 'read' })
  @Get('payroll-runs/:id/payslips')
  async runPayslips(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: PrintQueryDto) {
    return pdf(await this.printing.runPayslips(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'Payroll register (landscape A4)' })
  @RequirePermissions({ module: 'hr', screen: 'payroll', action: 'read' })
  @Get('payroll-runs/:id/register')
  async payrollRegister(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PrintQueryDto,
  ) {
    return pdf(await this.printing.payrollRegister(tenantId, id, q), q);
  }

  @ApiOperation({ summary: 'Customer / supplier statement of account (كشف حساب)' })
  @RequirePermissions({ module: 'reports', screen: 'partners', action: 'read' })
  @Get('statements/:partnerType/:partnerId')
  async statement(
    @CurrentTenant() tenantId: string,
    @Param('partnerType') partnerType: string,
    @Param('partnerId', ParseUUIDPipe) partnerId: string,
    @Query() q: StatementPrintQueryDto,
  ) {
    if (partnerType !== 'customer' && partnerType !== 'supplier') {
      throw new BadRequestException('partnerType must be customer or supplier');
    }
    return pdf(await this.printing.statement(tenantId, partnerType, partnerId, q), q);
  }

  @ApiOperation({ summary: 'Print an issued cheque on its bank layout' })
  @RequirePermissions({ module: 'treasury', screen: 'cheques', action: 'read' })
  @Get('cheques/:id')
  async cheque(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ChequePrintQueryDto,
  ) {
    return pdf(await this.printing.cheque(tenantId, id, q), {});
  }
}
