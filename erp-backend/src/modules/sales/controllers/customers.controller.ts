import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CustomersService } from '../services/customers.service';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateCustomerDto) {
    return this.customersService.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.customersService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.customersService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateCustomerDto>,
  ) {
    return this.customersService.update(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'delete' })
  @Delete(':id')
  deactivate(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.customersService.update(tenantId, id, { isActive: false } as any);
  }
}
