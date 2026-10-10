import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StockIssuesService } from '../services/stock-issues.service';
import { CreateStockIssueDto, StockIssueQueryDto } from '../dto/stock-issue.dto';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

/** Damage / donation / internal use / sample issues (إذن صرف تالف وتبرعات). */
@ApiTags('inventory')
@ApiBearerAuth()
@Controller('inventory/issues')
export class StockIssuesController {
  constructor(private readonly issues: StockIssuesService) {}

  @RequirePermissions({ module: 'inventory', screen: 'stock_issues', action: 'create' })
  @Post()
  @ApiOperation({ summary: 'Create a stock issue (ISS-): damage, donation, internal_use or sample' })
  create(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateStockIssueDto) {
    return this.issues.create(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock_issues', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() query: StockIssueQueryDto) {
    return this.issues.findAll(tenantId, query);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock_issues', action: 'read' })
  @Get(':id')
  findById(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.issues.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock_issues', action: 'update' })
  @Post(':id/post')
  post(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.issues.post(tenantId, user.sub, id);
  }

  @RequirePermissions({ module: 'inventory', screen: 'stock_issues', action: 'update' })
  @Post(':id/cancel')
  cancel(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.issues.cancel(tenantId, user.sub, id);
  }
}
