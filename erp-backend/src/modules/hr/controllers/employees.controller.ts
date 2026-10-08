import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { EmployeesService } from '../services/employees.service';
import {
  CreateEmployeeDto,
  EmployeeQueryDto,
  TerminateEmployeeDto,
  UpdateEmployeeDto,
} from '../dto/employee.dto';

@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr/employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @RequirePermissions({ module: 'hr', screen: 'employees', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: EmployeeQueryDto) {
    return this.employees.findAll(tenantId, query);
  }

  @RequirePermissions({ module: 'hr', screen: 'employees', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.employees.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'hr', screen: 'employees', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'hr', screen: 'employees', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'hr', screen: 'employees', action: 'update' })
  @Post(':id/terminate')
  terminate(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TerminateEmployeeDto,
  ) {
    return this.employees.terminate(tenantId, id, dto);
  }
}
