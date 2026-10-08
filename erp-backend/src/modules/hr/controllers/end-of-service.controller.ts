import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { EndOfServiceService } from '../services/end-of-service.service';
import {
  CancelFinalSettlementDto,
  CreateEosProvisionDto,
  CreateFinalSettlementDto,
  FinalSettlementQueryDto,
  PayFinalSettlementDto,
  PostFinalSettlementDto,
} from '../dto/eos.dto';

const READ = { module: 'hr', screen: 'payroll', action: 'read' };
const CREATE = { module: 'hr', screen: 'payroll', action: 'create' };
const APPROVE = { module: 'hr', screen: 'payroll', action: 'approve' };

/** End-of-service provision and final settlements. */
@ApiTags('hr')
@ApiBearerAuth()
@Controller('hr')
export class EndOfServiceController {
  constructor(private readonly eos: EndOfServiceService) {}

  @RequirePermissions(READ)
  @Get('eos-provisions')
  findProvisions(@CurrentTenant() tenantId: string) {
    return this.eos.findProvisions(tenantId);
  }

  @RequirePermissions(READ)
  @Get('eos-provisions/:id')
  findProvision(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.eos.findProvision(tenantId, id);
  }

  @RequirePermissions(APPROVE)
  @Post('eos-provisions')
  @ApiOperation({ summary: 'Post the monthly gratuity provision (liability at month end - booked)' })
  createProvision(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateEosProvisionDto,
  ) {
    return this.eos.createProvision(tenantId, user.sub, dto);
  }

  @RequirePermissions(APPROVE)
  @Post('eos-provisions/:id/reverse')
  reverseProvision(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFinalSettlementDto,
  ) {
    return this.eos.reverseProvision(tenantId, user.sub, id, dto.date);
  }

  @RequirePermissions(READ)
  @Get('final-settlements')
  findSettlements(@CurrentTenant() tenantId: string, @Query() query: FinalSettlementQueryDto) {
    return this.eos.findSettlements(tenantId, query);
  }

  @RequirePermissions(READ)
  @Get('final-settlements/:id')
  findSettlement(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.eos.findSettlement(tenantId, id);
  }

  @RequirePermissions(CREATE)
  @Post('final-settlements')
  @ApiOperation({ summary: 'Compute a draft final settlement for a terminated employee' })
  createSettlement(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFinalSettlementDto,
  ) {
    return this.eos.createSettlement(tenantId, user.sub, dto);
  }

  @RequirePermissions(APPROVE)
  @Post('final-settlements/:id/post')
  postSettlement(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostFinalSettlementDto,
  ) {
    return this.eos.postSettlement(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(APPROVE)
  @Post('final-settlements/:id/pay')
  paySettlement(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PayFinalSettlementDto,
  ) {
    return this.eos.paySettlement(tenantId, user.sub, id, dto);
  }

  @RequirePermissions(APPROVE)
  @Post('final-settlements/:id/cancel')
  cancelSettlement(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelFinalSettlementDto,
  ) {
    return this.eos.cancelSettlement(tenantId, user.sub, id, dto);
  }
}
