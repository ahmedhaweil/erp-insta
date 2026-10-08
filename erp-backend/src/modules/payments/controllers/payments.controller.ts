import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { PaymentsService } from '../services/payments.service';
import { AllocatePaymentDto, CreatePaymentDto } from '../dto/create-payment.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @RequirePermissions({ module: 'accounting', screen: 'payments', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
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
