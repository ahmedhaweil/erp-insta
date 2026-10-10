import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CustomersService } from '../services/customers.service';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import {
  BlockCustomerDto,
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from '../dto/customer-extras.dto';
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

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'update' })
  @Post(':id/block')
  block(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: BlockCustomerDto) {
    return this.customersService.block(tenantId, id, dto.reason);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'update' })
  @Post(':id/unblock')
  unblock(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.customersService.unblock(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'read' })
  @Get(':id/addresses')
  findAddresses(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.customersService.findAddresses(tenantId, id);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'update' })
  @Post(':id/addresses')
  addAddress(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateCustomerAddressDto,
  ) {
    return this.customersService.addAddress(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'update' })
  @Patch(':id/addresses/:addressId')
  updateAddress(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    return this.customersService.updateAddress(tenantId, id, addressId, dto);
  }

  @RequirePermissions({ module: 'sales', screen: 'customers', action: 'update' })
  @Delete(':id/addresses/:addressId')
  removeAddress(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
  ) {
    return this.customersService.removeAddress(tenantId, id, addressId);
  }
}
