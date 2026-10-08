import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { AttendanceService } from '../services/attendance.service';
import {
  AttendanceQueryDto,
  AttendanceSummaryQueryDto,
  ImportAttendanceDto,
  UpsertAttendanceDto,
} from '../dto/attendance.dto';

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @RequirePermissions({ module: 'hr', screen: 'attendance', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: AttendanceQueryDto) {
    return this.attendance.findAll(tenantId, query);
  }

  @RequirePermissions({ module: 'hr', screen: 'attendance', action: 'read' })
  @Get('summary')
  @ApiOperation({ summary: 'Absence days, late minutes, overtime hours and leave days per employee' })
  summary(@CurrentTenant() tenantId: string, @Query() query: AttendanceSummaryQueryDto) {
    return this.attendance.summary(tenantId, query);
  }

  @RequirePermissions({ module: 'hr', screen: 'attendance', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Create or replace the check-in/out of an employee for a day' })
  upsert(@CurrentTenant() tenantId: string, @Body() dto: UpsertAttendanceDto) {
    return this.attendance.upsert(tenantId, dto);
  }

  @RequirePermissions({ module: 'hr', screen: 'attendance', action: 'create' })
  @Post('import')
  @ApiOperation({ summary: 'Bulk import of check-in/out records (JSON), matched by employee id or code' })
  import(@CurrentTenant() tenantId: string, @Body() dto: ImportAttendanceDto) {
    return this.attendance.import(tenantId, dto);
  }

  @RequirePermissions({ module: 'hr', screen: 'attendance', action: 'delete' })
  @Delete(':id')
  remove(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.remove(tenantId, id);
  }
}
