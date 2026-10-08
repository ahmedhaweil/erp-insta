import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { OvertimeService } from '../services/overtime.service';
import { CreateOvertimeRequestDto, OvertimeQueryDto } from '../dto/overtime.dto';
import { DecideLeaveDto } from '../dto/leave.dto';

const READ = { module: 'hr', screen: 'attendance', action: 'read' };
const CREATE = { module: 'hr', screen: 'attendance', action: 'create' };
const UPDATE = { module: 'hr', screen: 'attendance', action: 'update' };
const APPROVE = { module: 'hr', screen: 'attendance', action: 'approve' };

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/overtime-requests')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  @RequirePermissions(READ)
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: OvertimeQueryDto) {
    return this.overtime.findAll(tenantId, query);
  }

  @RequirePermissions(READ)
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.overtime.findById(tenantId, id);
  }

  @RequirePermissions(CREATE)
  @Post()
  create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOvertimeRequestDto,
  ) {
    return this.overtime.create(tenantId, user.sub, dto);
  }

  @RequirePermissions(APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
  ) {
    return this.overtime.approve(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(APPROVE)
  @Post(':id/reject')
  reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideLeaveDto,
  ) {
    return this.overtime.reject(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(UPDATE)
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.overtime.cancel(tenantId, user.sub, id);
  }
}
