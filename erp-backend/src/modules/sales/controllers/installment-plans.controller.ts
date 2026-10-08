import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InstallmentPlansService } from '../services/installment-plans.service';
import { CreateInstallmentPlanDto, InstallmentReportQueryDto } from '../dto/installment-plan.dto';
import { InstallmentPlanStatus } from '../entities/installment-plan.entity';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class InstallmentPlansController {
  constructor(private readonly plans: InstallmentPlansService) {}

  @RequirePermissions({ module: 'sales', screen: 'installments', action: 'create' })
  @Post('installment-plans')
  @ApiOperation({ summary: 'Create an installment plan on a posted invoice' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateInstallmentPlanDto,
  ) {
    return this.plans.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'installments', action: 'read' })
  @Get('installment-plans')
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'invoiceId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: InstallmentPlanStatus })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query('customerId') customerId?: string,
    @Query('invoiceId') invoiceId?: string,
    @Query('status') status?: InstallmentPlanStatus,
  ) {
    return this.plans.findAll(tenantId, { customerId, invoiceId, status });
  }

  @RequirePermissions({ module: 'sales', screen: 'installments', action: 'read' })
  @Get('installment-plans/:id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.plans.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'installments', action: 'update' })
  @Post('installment-plans/:id/recompute')
  @ApiOperation({ summary: 'Re-allocate the invoice paid amount to the installments by due date' })
  recompute(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.plans.recompute(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'installments', action: 'update' })
  @Post('installment-plans/:id/cancel')
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.plans.cancel(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'installments', action: 'update' })
  @Post('invoices/:id/installments/recompute')
  @ApiOperation({ summary: 'Recompute installment statuses of an invoice from its paid amount' })
  recomputeInvoice(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.plans.recomputeInvoice(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'installments', action: 'read' })
  @Get('installments/due')
  @ApiOperation({ summary: 'Due and overdue installments (collection report)' })
  due(@CurrentTenant() tenantId: string, @Query() query: InstallmentReportQueryDto) {
    return this.plans.dueReport(tenantId, query);
  }

  @RequirePermissions({ module: 'sales', screen: 'installments', action: 'read' })
  @Get('customers/:id/installment-statement')
  @ApiQuery({ name: 'asOf', required: false })
  statement(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.plans.customerStatement(tenantId, id, asOf || undefined);
  }
}
