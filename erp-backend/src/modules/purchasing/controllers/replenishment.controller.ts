import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { ReplenishmentService } from '../services/replenishment.service';
import { GenerateReplenishmentDto } from '../dto/purchase-actions.dto';

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('purchasing/replenishment')
export class ReplenishmentController {
  constructor(private readonly replenishmentService: ReplenishmentService) {}

  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'read' })
  @Get()
  getSuggestions(@CurrentTenant() tenantId: string) {
    return this.replenishmentService.getSuggestions(tenantId);
  }

  @RequirePermissions({ module: 'purchasing', screen: 'orders', action: 'create' })
  @Post('generate')
  generate(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateReplenishmentDto,
  ) {
    return this.replenishmentService.generate(tenantId, user.sub, dto);
  }
}
