import { Body, Controller, Get, Optional, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { VouchersService } from '../services/vouchers.service';
import {
  CancelDto,
  CreateVoucherDto,
  UpdateVoucherDto,
  VoucherQueryDto,
} from '../dto/treasury.dto';
import { VoucherType } from '../entities/treasury-voucher.entity';
import { ApprovalsService } from '@modules/approvals/services/approvals.service';
import { ApprovalDocumentType } from '@modules/approvals/entities/approval-rule.entity';

@ApiTags('treasury')
@ApiBearerAuth()
@Controller('treasury/vouchers')
export class VouchersController {
  constructor(
    private readonly vouchers: VouchersService,
    @Optional() private readonly approvals?: ApprovalsService,
  ) {}

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: VoucherQueryDto) {
    return this.vouchers.findAll(tenantId, query);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'create' })
  @Post()
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVoucherDto,
  ) {
    // Approval engine (no-op without a matching "treasury_voucher" rule): a
    // payment voucher created with post=true above the threshold is kept as a
    // draft with a pending approval request instead of being posted.
    if (this.approvals && dto.post && dto.type === VoucherType.PAYMENT) {
      const amount =
        dto.lines.reduce((s, l) => s + Number(l.amount), 0) * (Number(dto.exchangeRate) || 1);
      if (await this.approvals.findApplicableRule(tenantId, ApprovalDocumentType.TREASURY_VOUCHER, amount)) {
        const draft = await this.vouchers.create(tenantId, user.sub, { ...dto, post: false });
        const request = await this.approvals.submit(tenantId, user.sub, {
          documentType: ApprovalDocumentType.TREASURY_VOUCHER,
          documentId: draft.id,
          documentRef: draft.voucherNumber,
          amount,
          description: `Payment voucher ${draft.voucherNumber}`,
        });
        return { ...draft, approvalRequestId: request?.id, approvalStatus: request?.status };
      }
    }
    return this.vouchers.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.vouchers.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVoucherDto,
  ) {
    return this.vouchers.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'post' })
  @Post(':id/post')
  async post(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    if (this.approvals) {
      const voucher = await this.vouchers.findById(tenantId, id);
      if (voucher.type === VoucherType.PAYMENT && voucher.status === 'draft') {
        // Throws 409 with a pending request when a rule applies and is not yet approved.
        await this.approvals.ensureApproved(tenantId, user.sub, {
          documentType: ApprovalDocumentType.TREASURY_VOUCHER,
          documentId: voucher.id,
          documentRef: voucher.voucherNumber,
          documentTable: 'treasury_vouchers',
          amount: Number(voucher.amount) * (Number(voucher.exchangeRate) || 1),
          description: `Payment voucher ${voucher.voucherNumber}`,
        });
      }
    }
    return this.vouchers.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'treasury', screen: 'vouchers', action: 'cancel' })
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CancelDto,
  ) {
    return this.vouchers.cancel(tenantId, user.sub, id, dto);
  }
}
