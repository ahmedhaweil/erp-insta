import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { LoansService } from '../services/loans.service';
import { CreateLoanDto, DisburseLoanDto, LoanQueryDto } from '../dto/loan.dto';

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @RequirePermissions({ module: 'hr', screen: 'loans', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: LoanQueryDto) {
    return this.loans.findAll(tenantId, query);
  }

  @RequirePermissions({ module: 'hr', screen: 'loans', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.loans.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'hr', screen: 'loans', action: 'create' })
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateLoanDto,
  ) {
    return this.loans.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'hr', screen: 'loans', action: 'approve' })
  @Post(':id/disburse')
  @ApiOperation({ summary: 'Pay the loan (Dr employee advances / Cr cash or bank) and schedule installments' })
  disburse(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisburseLoanDto,
  ) {
    return this.loans.disburse(tenantId, user.sub, id, dto);
  }

  @RequirePermissions({ module: 'hr', screen: 'loans', action: 'update' })
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.loans.cancel(tenantId, user.sub, id);
  }
}
