import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { HrOrganizationService } from '../services/hr-organization.service';
import { HrSettingsService } from '../services/hr-settings.service';
import { EmployeesService } from '../services/employees.service';
import {
  CreateDepartmentDto,
  CreateJobTitleDto,
  CreatePublicHolidayDto,
  CreateWorkScheduleDto,
  UpdateDepartmentDto,
  UpdateHrSettingsDto,
  UpdateJobTitleDto,
  UpdateWorkScheduleDto,
} from '../dto/organization.dto';
import { GratuityDto } from '../dto/employee.dto';

const READ = { module: 'hr', screen: 'employees', action: 'read' };
const CREATE = { module: 'hr', screen: 'employees', action: 'create' };
const UPDATE = { module: 'hr', screen: 'employees', action: 'update' };

/** HR master data: departments, job titles, work schedules, holidays, payroll rules. */
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
export class HrSetupController {
  constructor(
    private readonly organization: HrOrganizationService,
    private readonly settings: HrSettingsService,
    private readonly employees: EmployeesService,
  ) {}

  @RequirePermissions(READ)
  @Get('departments')
  listDepartments(@CurrentTenant() tenantId: string) {
    return this.organization.listDepartments(tenantId);
  }

  @RequirePermissions(CREATE)
  @Post('departments')
  createDepartment(@CurrentTenant() tenantId: string, @Body() dto: CreateDepartmentDto) {
    return this.organization.createDepartment(tenantId, dto);
  }

  @RequirePermissions(UPDATE)
  @Patch('departments/:id')
  updateDepartment(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.organization.updateDepartment(tenantId, id, dto);
  }

  @RequirePermissions(READ)
  @Get('job-titles')
  listJobTitles(@CurrentTenant() tenantId: string) {
    return this.organization.listJobTitles(tenantId);
  }

  @RequirePermissions(CREATE)
  @Post('job-titles')
  createJobTitle(@CurrentTenant() tenantId: string, @Body() dto: CreateJobTitleDto) {
    return this.organization.createJobTitle(tenantId, dto);
  }

  @RequirePermissions(UPDATE)
  @Patch('job-titles/:id')
  updateJobTitle(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobTitleDto,
  ) {
    return this.organization.updateJobTitle(tenantId, id, dto);
  }

  @RequirePermissions(READ)
  @Get('work-schedules')
  listSchedules(@CurrentTenant() tenantId: string) {
    return this.organization.listSchedules(tenantId);
  }

  @RequirePermissions(CREATE)
  @Post('work-schedules')
  createSchedule(@CurrentTenant() tenantId: string, @Body() dto: CreateWorkScheduleDto) {
    return this.organization.createSchedule(tenantId, dto);
  }

  @RequirePermissions(UPDATE)
  @Patch('work-schedules/:id')
  updateSchedule(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkScheduleDto,
  ) {
    return this.organization.updateSchedule(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'hr', screen: 'attendance', action: 'read' })
  @Get('holidays')
  @ApiQuery({ name: 'year', required: false })
  listHolidays(@CurrentTenant() tenantId: string, @Query('year') year?: string) {
    return this.organization.listHolidays(tenantId, year ? Number(year) : undefined);
  }

  @RequirePermissions({ module: 'hr', screen: 'attendance', action: 'create' })
  @Post('holidays')
  createHoliday(@CurrentTenant() tenantId: string, @Body() dto: CreatePublicHolidayDto) {
    return this.organization.createHoliday(tenantId, dto);
  }

  @RequirePermissions({ module: 'hr', screen: 'attendance', action: 'delete' })
  @Delete('holidays/:id')
  deleteHoliday(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.organization.deleteHoliday(tenantId, id);
  }

  @RequirePermissions({ module: 'hr', screen: 'payroll', action: 'read' })
  @Get('settings')
  @ApiOperation({ summary: 'Effective payroll rules (defaults merged with tenant overrides)' })
  getSettings(@CurrentTenant() tenantId: string) {
    return this.settings.get(tenantId);
  }

  @RequirePermissions({ module: 'hr', screen: 'payroll', action: 'update' })
  @Put('settings')
  @ApiOperation({
    summary: 'Replace the tenant overrides of the payroll rules (insurance rates, wage caps, tax brackets)',
  })
  updateSettings(@CurrentTenant() tenantId: string, @Body() dto: UpdateHrSettingsDto) {
    return this.settings.update(tenantId, dto.rules as any);
  }

  @RequirePermissions({ module: 'hr', screen: 'payroll', action: 'read' })
  @Post('gratuity')
  @ApiOperation({ summary: 'End-of-service gratuity (Saudi Labour Law art. 84/85; not statutory in Egypt)' })
  gratuity(@CurrentTenant() tenantId: string, @Body() dto: GratuityDto) {
    return this.employees.gratuity(tenantId, dto);
  }
}
