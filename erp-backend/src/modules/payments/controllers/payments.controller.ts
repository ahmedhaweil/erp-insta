import { Body, Controller, Get, Optional, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { PaymentsService } from '../services/payments.service';
import { AllocatePaymentDto, CreatePaymentDto } from '../dto/create-payment.dto';
import { PaymentDirection, PaymentPartnerType } from '../entities/payment.entity';
import {
  ApprovalsService,
  fingerprintOf,
} from '@modules/approvals/services/approvals.service';
import { ApprovalDocumentType } from '@modules/approvals/entities/approval-rule.entity';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Optional() private readonly approvals?: ApprovalsService,
  ) {}

  @RequirePermissions({ module: 'accounting', screen: 'payments', action: 'create' })
  @Post()
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    // Approval engine (no-op without an active "payment" rule): an outbound
    // payment above the threshold is not created; a pending request holding
    // the payload is recorded (409) and the payment is created on approval.
    const direction =
      dto.direction ??
      (dto.partnerType === PaymentPartnerType.CUSTOMER
        ? PaymentDirection.INBOUND
        : PaymentDirection.OUTBOUND);
    if (this.approvals && direction === PaymentDirection.OUTBOUND) {
      const payload = { ...dto } as Record<string, any>;
      await this.approvals.ensureApproved(tenantId, user.sub, {
        documentType: ApprovalDocumentType.PAYMENT,
        fingerprint: fingerprintOf({ ...payload, requestedBy: user.sub }),
        documentRef: `${dto.partnerType} payment ${dto.amount} on ${dto.date}`,
        amount: Number(dto.amount) * (Number(dto.exchangeRate) || 1),
        description: `Outbound ${dto.method ?? 'cash'} payment of ${dto.amount}`,
        payload,
      });
    }
    return this.paymentsService.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'accounting', screen: 'payments', action: 'read' })
  @Get()
  @ApiQuery({ name: 'partnerId', required: false })
  @ApiQuery({ name: 'treasuryId', required: false })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('partnerId') partnerId?: string,
    @Query('treasuryId') treasuryId?: string,
  ) {
    return this.paymentsService.findAll(tenantId, partnerId, treasuryId);
  }

  /** Open invoices / credit notes / bills / refunds a payment of this partner can settle. */
  @RequirePermissions({ module: 'accounting', screen: 'payments', action: 'read' })
  @Get('open-documents')
  @ApiQuery({ name: 'partnerType', enum: PaymentPartnerType })
  @ApiQuery({ name: 'partnerId' })
  @ApiQuery({ name: 'direction', enum: PaymentDirection, required: false })
  openDocuments(
    @CurrentTenant() tenantId: string,
    @Query('partnerType', new ParseEnumPipe(PaymentPartnerType)) partnerType: PaymentPartnerType,
    @Query('partnerId', ParseUUIDPipe) partnerId: string,
    @Query('direction', new ParseEnumPipe(PaymentDirection, { optional: true })) direction?: PaymentDirection,
  ) {
    return this.paymentsService.openDocuments(tenantId, {
      partnerType,
      partnerId,
      direction:
        direction ??
        (partnerType === PaymentPartnerType.CUSTOMER ? PaymentDirection.INBOUND : PaymentDirection.OUTBOUND),
    });
  }

  @RequirePermissions({ module: 'accounting', screen: 'payments', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.paymentsService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'accounting', screen: 'payments', action: 'update' })
  @Post(':id/allocate')
  allocate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AllocatePaymentDto,
  ) {
    return this.paymentsService.allocate(tenantId, id, dto, user.sub);
  }

  @RequirePermissions({ module: 'accounting', screen: 'payments', action: 'update' })
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.paymentsService.cancel(tenantId, user.sub, id);
  }
}
