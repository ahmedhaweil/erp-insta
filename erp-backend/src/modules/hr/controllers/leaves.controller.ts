import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { LeavesService } from '../services/leaves.service';
import {
  CreateLeaveEncashmentDto,
  LeaveEncashmentQueryDto,
  CreateLeaveRequestDto,
  CreateLeaveTypeDto,
  DecideLeaveDto,
  LeaveRequestQueryDto,
  UpdateLeaveTypeDto,
} from '../dto/leave.dto';

const READ = { module: 'hr', screen: 'leaves', action: 'read' };
const CREATE = { module: 'hr', screen: 'leaves', action: 'create' };
const UPDATE = { module: 'hr', screen: 'leaves', action: 'update' };
const APPROVE = { module: 'hr', screen: 'leaves', action: 'approve' };

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  @RequirePermissions(READ)
  @Get('leave-types')
  listTypes(@CurrentTenant() tenantId: string) {
    return this.leaves.listTypes(tenantId);
  }

  @RequirePermissions(CREATE)
  @Post('leave-types')
  createType(@CurrentTenant() tenantId: string, @Body() dto: CreateLeaveTypeDto) {
    return this.leaves.createType(tenantId, dto);
  }

  @RequirePermissions(UPDATE)
  @Patch('leave-types/:id')
  updateType(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.leaves.updateType(tenantId, id, dto);
  }

  @RequirePermissions(READ)
  @Get('leave-requests')
  findAll(@CurrentTenant() tenantId: string, @Query() query: LeaveRequestQueryDto) {
    return this.leaves.findAll(tenantId, query);
  }

  @RequirePermissions(READ)
  @Get('leave-requests/:id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.leaves.findById(tenantId, id);
  }

  @RequirePermissions(CREATE)
  @Post('leave-requests')
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    return this.leaves.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(APPROVE)
  @Post('leave-requests/:id/approve')
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
  ) {
    return this.leaves.approve(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(APPROVE)
  @Post('leave-requests/:id/reject')
  reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
  ) {
    return this.leaves.reject(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(UPDATE)
  @Post('leave-requests/:id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.leaves.cancel(tenantId, user.sub, id);
  }

  @RequirePermissions(READ)
  @Get('employees/:id/leave-balances')
  @ApiQuery({ name: 'year', required: true })
  @ApiQuery({ name: 'asOf', required: false, description: 'Balance date (accrual / carry expiry)' })
  balances(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('asOf') asOf?: string,
  ) {
    return this.leaves.balances(tenantId, id, year, asOf);
  }

  @RequirePermissions(READ)
  @Get('leave-encashments')
  findEncashments(@CurrentTenant() tenantId: string, @Query() query: LeaveEncashmentQueryDto) {
    return this.leaves.findEncashments(tenantId, query);
  }

  @RequirePermissions(APPROVE)
  @Post('leave-encashments')
  @ApiOperation({ summary: 'Encash unused leave days: a taxable payroll addition of the given month' })
  createEncashment(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateLeaveEncashmentDto,
  ) {
    return this.leaves.createEncashment(tenantId, user.sub, dto);
  }

  @RequirePermissions(APPROVE)
  @Post('leave-encashments/:id/cancel')
  cancelEncashment(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.leaves.cancelEncashment(tenantId, id);
  }

  @RequirePermissions(READ)
  @Get('reports/leave-balances')
  @ApiQuery({ name: 'year', required: true })
  balancesReport(@CurrentTenant() tenantId: string, @Query('year', ParseIntPipe) year: number) {
    return this.leaves.balancesReport(tenantId, year);
  }
}
