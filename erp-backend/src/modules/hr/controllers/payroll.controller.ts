import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { PayrollService } from '../services/payroll.service';
import { CsvFile } from '../csv-file';
import { BankFileQueryDto } from '../dto/payroll.dto';
import {
  ApprovePayrollRunDto,
  CreatePayrollAdjustmentDto,
  CreatePayrollRunDto,
  PayPayrollRunDto,
  PayrollAdjustmentQueryDto,
  PayrollRunQueryDto,
  PeriodQueryDto,
  ReversePayrollRunDto,
} from '../dto/payroll.dto';

const READ = { module: 'hr', screen: 'payroll', action: 'read' };
const CREATE = { module: 'hr', screen: 'payroll', action: 'create' };
const UPDATE = { module: 'hr', screen: 'payroll', action: 'update' };
const APPROVE = { module: 'hr', screen: 'payroll', action: 'approve' };

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  // ------------------------------------------------------------ adjustments

  @RequirePermissions(READ)
  @Get('payroll-adjustments')
  findAdjustments(@CurrentTenant() tenantId: string, @Query() query: PayrollAdjustmentQueryDto) {
    return this.payroll.findAdjustments(tenantId, query);
  }

  @RequirePermissions(CREATE)
  @Post('payroll-adjustments')
  @ApiOperation({ summary: 'One-off addition (bonus...) or deduction (penalty...) for a month' })
  createAdjustment(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePayrollAdjustmentDto,
  ) {
    return this.payroll.createAdjustment(tenantId, user.sub, dto);
  }

  @RequirePermissions(UPDATE)
  @Delete('payroll-adjustments/:id')
  deleteAdjustment(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.deleteAdjustment(tenantId, id);
  }

  // ------------------------------------------------------------ runs

  @RequirePermissions(READ)
  @Get('payroll-runs')
  findAll(@CurrentTenant() tenantId: string, @Query() query: PayrollRunQueryDto) {
    return this.payroll.findAll(tenantId, query);
  }

  @RequirePermissions(READ)
  @Get('payroll-runs/:id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.findById(tenantId, id);
  }

  @RequirePermissions(CREATE)
  @Post('payroll-runs')
  @ApiOperation({ summary: 'Create and compute a draft payroll run for a month (optionally a branch/department)' })
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePayrollRunDto,
  ) {
    return this.payroll.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(UPDATE)
  @Post('payroll-runs/:id/recompute')
  recompute(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.recompute(tenantId, id);
  }

  @RequirePermissions(APPROVE)
  @Post('payroll-runs/:id/approve')
  @ApiOperation({ summary: 'Approve: recompute, post the accrual entry, recover loan installments' })
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePayrollRunDto,
  ) {
    return this.payroll.approve(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(APPROVE)
  @Post('payroll-runs/:id/pay')
  @ApiOperation({ summary: 'Pay net salaries from cash or bank (Dr salaries payable / Cr cash|bank)' })
  pay(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayPayrollRunDto,
  ) {
    return this.payroll.pay(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(UPDATE)
  @Post('payroll-runs/:id/cancel')
  cancel(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.cancel(tenantId, id);
  }

  @RequirePermissions(APPROVE)
  @Post('payroll-runs/:id/reverse')
  @ApiOperation({ summary: 'Reverse an approved/paid run (journal reversals, loan installments restored)' })
  reverse(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReversePayrollRunDto,
  ) {
    return this.payroll.reverse(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(READ)
  @Get('payroll-runs/:id/payslips/:employeeId')
  payslip(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.payroll.payslip(tenantId, id, employeeId);
  }

  @RequirePermissions(READ)
  @Get('payroll-runs/:id/bank-file')
  @ApiOperation({
    summary:
      'Salary transfer file (format=generic bank sheet with IBAN, or wps = Saudi WPS/Mudad style); download=true streams the CSV',
  })
  async bankFile(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: BankFileQueryDto,
  ) {
    const file = await this.payroll.bankFile(tenantId, id, query);
    if (query.download === 'true' || query.download === '1') return new CsvFile(file.content, file.filename);
    return file;
  }

  // ------------------------------------------------------------ reports

  @RequirePermissions(READ)
  @Get('payroll-runs/:id/register')
  @ApiOperation({ summary: 'Payroll register (per-employee lines and totals)' })
  register(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payroll.register(tenantId, id);
  }

  @RequirePermissions(READ)
  @Get('reports/social-insurance')
  @ApiOperation({ summary: 'Social insurance / GOSI contributions of the approved runs of a month' })
  socialInsurance(@CurrentTenant() tenantId: string, @Query() query: PeriodQueryDto) {
    return this.payroll.socialInsuranceReport(tenantId, query.period);
  }
}
