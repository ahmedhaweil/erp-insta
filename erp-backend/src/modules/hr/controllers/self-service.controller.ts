import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { EmployeesService } from '../services/employees.service';
import { LeavesService } from '../services/leaves.service';
import { LoansService } from '../services/loans.service';
import { PayrollService } from '../services/payroll.service';
import { OvertimeService } from '../services/overtime.service';
import { MyLeaveRequestDto } from '../dto/leave.dto';
import { MyOvertimeRequestDto } from '../dto/overtime.dto';
import { LeaveRequestStatus } from '../entities/leave-request.entity';
import { today } from '@shared/utils/document-totals.util';

/**
 * Employee self-service: every endpoint is scoped to the employee linked to
 * the signed-in user (hr_employees.user_id); no HR permission is needed.
 */
@ApiTags('hr-self-service')
@ApiBearerAuth()
@Controller('hr/me')
export class SelfServiceController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly leaves: LeavesService,
    private readonly loans: LoansService,
    private readonly payroll: PayrollService,
    private readonly overtime: OvertimeService,
  ) {}

  private me(tenantId: string, user: JwtPayload) {
    return this.employees.findByUser(tenantId, user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'My employee profile' })
  async profile(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    const e = await this.me(tenantId, user);
    return {
      id: e.id,
      code: e.code,
      nameEn: e.nameEn,
      nameAr: e.nameAr,
      hireDate: e.hireDate,
      branchId: e.branchId,
      departmentId: e.departmentId,
      jobTitleId: e.jobTitleId,
      managerId: e.managerId,
      email: e.email,
      phone: e.phone,
      bankName: e.bankName,
      iban: e.iban,
      payrollCountry: e.payrollCountry,
      status: e.status,
    };
  }

  @Get('payslips')
  @ApiOperation({ summary: 'My payslips (approved / paid payroll runs)' })
  async payslips(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    const e = await this.me(tenantId, user);
    return this.payroll.payslipsOf(tenantId, e.id);
  }

  @Get('payslips/:runId')
  async payslip(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    const e = await this.me(tenantId, user);
    const slip = await this.payroll.payslip(tenantId, runId, e.id);
    if (!['approved', 'paid'].includes(String(slip.run.status))) {
      throw new ForbiddenException('The payslip is not released yet');
    }
    return slip;
  }

  @Get('leave-balances')
  @ApiQuery({ name: 'year', required: false })
  async balances(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Query('year') year?: string,
  ) {
    const e = await this.me(tenantId, user);
    return this.leaves.balances(tenantId, e.id, year ? Number(year) : Number(today().slice(0, 4)));
  }

  @Get('leave-types')
  listLeaveTypes(@CurrentTenant() tenantId: string) {
    return this.leaves.listTypes(tenantId).then((types) => types.filter((t) => t.isActive));
  }

  @Get('leave-requests')
  async leaveRequests(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    const e = await this.me(tenantId, user);
    return this.leaves.findAll(tenantId, { employeeId: e.id });
  }

  @Post('leave-requests')
  @ApiOperation({ summary: 'Request a leave (draft, approved by HR)' })
  async requestLeave(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: MyLeaveRequestDto,
  ) {
    const e = await this.me(tenantId, user);
    return this.leaves.create(tenantId, user.sub, { ...dto, employeeId: e.id });
  }

  @Post('leave-requests/:id/cancel')
  @ApiOperation({ summary: 'Withdraw one of my draft leave requests' })
  async cancelLeave(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const e = await this.me(tenantId, user);
    const request = await this.leaves.findById(tenantId, id);
    if (request.employeeId !== e.id) throw new ForbiddenException('Not your leave request');
    if (request.status !== LeaveRequestStatus.DRAFT) {
      throw new ForbiddenException('Only draft requests can be withdrawn; ask HR to cancel approved leave');
    }
    return this.leaves.cancel(tenantId, user.sub, id);
  }

  @Get('loans')
  async loans_(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    const e = await this.me(tenantId, user);
    const loans = await this.loans.findAll(tenantId, { employeeId: e.id });
    return Promise.all(loans.map((l) => this.loans.findById(tenantId, l.id)));
  }

  @Get('overtime-requests')
  async overtimeRequests(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    const e = await this.me(tenantId, user);
    return this.overtime.findAll(tenantId, { employeeId: e.id });
  }

  @Post('overtime-requests')
  async requestOvertime(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: MyOvertimeRequestDto,
  ) {
    const e = await this.me(tenantId, user);
    return this.overtime.create(tenantId, user.sub, { ...dto, employeeId: e.id });
  }
}
