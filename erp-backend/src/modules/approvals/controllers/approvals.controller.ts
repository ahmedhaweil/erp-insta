import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';
import { ApprovalsService } from '../services/approvals.service';
import {
  ApprovalDecisionDto,
  ApprovalRequestQueryDto,
  CreateApprovalRuleDto,
  SubmitApprovalDto,
  UpdateApprovalRuleDto,
} from '../dto/approval.dto';
import { ApprovalDocumentType } from '../entities/approval-rule.entity';

@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  // ------------------------------------------------------------ rules

  @RequirePermissions({ module: 'approvals', screen: 'rules', action: 'read' })
  @Get('rules')
  @ApiQuery({ name: 'documentType', required: false, enum: ApprovalDocumentType })
  findRules(
    @CurrentTenant() tenantId: string,
    @Query('documentType') documentType?: ApprovalDocumentType,
  ) {
    return this.approvals.findRules(tenantId, documentType);
  }

  @RequirePermissions({ module: 'approvals', screen: 'rules', action: 'read' })
  @Get('rules/:id')
  findRule(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.findRule(tenantId, id);
  }

  @RequirePermissions({ module: 'approvals', screen: 'rules', action: 'create' })
  @Post('rules')
  createRule(@CurrentTenant() tenantId: string, @Body() dto: CreateApprovalRuleDto) {
    return this.approvals.createRule(tenantId, dto);
  }

  @RequirePermissions({ module: 'approvals', screen: 'rules', action: 'update' })
  @Patch('rules/:id')
  updateRule(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApprovalRuleDto,
  ) {
    return this.approvals.updateRule(tenantId, id, dto);
  }

  @RequirePermissions({ module: 'approvals', screen: 'rules', action: 'delete' })
  @Delete('rules/:id')
  @ApiOperation({ summary: 'Deactivate a rule (requests keep their snapshot)' })
  deactivateRule(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.deactivateRule(tenantId, id);
  }

  // --------------------------------------------------------- requests

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'read' })
  @Get('requests')
  findRequests(@CurrentTenant() tenantId: string, @Query() query: ApprovalRequestQueryDto) {
    return this.approvals.findAll(tenantId, query);
  }

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'read' })
  @Get('requests/mine/pending')
  @ApiOperation({ summary: 'Requests waiting for my approval' })
  myPending(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.approvals.myPending(tenantId, user.sub);
  }

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'read' })
  @Get('history/:documentType/:documentId')
  @ApiOperation({ summary: 'Approval history of one document' })
  history(
    @CurrentTenant() tenantId: string,
    @Param('documentType') documentType: ApprovalDocumentType,
    @Param('documentId', ParseUUIDPipe) documentId: string,
  ) {
    return this.approvals.history(tenantId, documentType, documentId);
  }

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'read' })
  @Get('requests/:id')
  findRequest(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.findById(tenantId, id);
  }

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'create' })
  @Post('requests')
  @ApiOperation({
    summary: 'Submit a manual approval request (for document types without an automatic hook)',
  })
  submit(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubmitApprovalDto,
  ) {
    return this.approvals.submit(tenantId, user.sub, dto);
  }

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'approve' })
  @Post('requests/:id/approve')
  approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.approvals.approve(tenantId, user.sub, id, dto.comment);
  }

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'approve' })
  @Post('requests/:id/reject')
  reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.approvals.reject(tenantId, user.sub, id, dto.comment);
  }

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'update' })
  @Post('requests/:id/cancel')
  cancel(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.approvals.cancel(tenantId, user.sub, id, dto.comment);
  }

  @RequirePermissions({ module: 'approvals', screen: 'requests', action: 'read' })
  @Post('requests/:id/comment')
  comment(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalDecisionDto,
  ) {
    return this.approvals.comment(tenantId, user.sub, id, dto.comment);
  }
}
