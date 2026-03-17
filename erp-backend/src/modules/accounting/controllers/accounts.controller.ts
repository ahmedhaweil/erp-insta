import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountsService } from '../services/accounts.service';
import { CreateAccountDto } from '../dto/create-account.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('accounting')
@ApiBearerAuth()
@Controller('accounting/accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @RequirePermissions({ module: 'accounting', screen: 'accounts', action: 'create' })
  @Post()
  create(@CurrentTenant() tenantId: string, @Body() dto: CreateAccountDto) {
    return this.accountsService.create(tenantId, dto);
  }

  @RequirePermissions({ module: 'accounting', screen: 'accounts', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.accountsService.findAll(tenantId);
  }

  @RequirePermissions({ module: 'accounting', screen: 'accounts', action: 'read' })
  @Get('tree')
  findTree(@CurrentTenant() tenantId: string) {
    return this.accountsService.findTree(tenantId);
  }

  @RequirePermissions({ module: 'accounting', screen: 'accounts', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.accountsService.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'accounting', screen: 'accounts', action: 'update' })
  @Patch(':id')
  update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateAccountDto>,
  ) {
    return this.accountsService.update(tenantId, id, dto);
  }
}
