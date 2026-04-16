import { Controller, Get, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from '../services/notifications.service';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @RequirePermissions({ module: 'notifications', screen: 'my', action: 'read' })
  @Get('my')
  getMyNotifications(@CurrentTenant() tenantId: string) {
    // userId would typically come from auth context; using tenantId as placeholder
    return this.notificationsService.findByUser(tenantId, tenantId);
  }

  @RequirePermissions({ module: 'notifications', screen: 'my', action: 'update' })
  @Patch(':id/read')
  markAsRead(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(tenantId, id);
  }

  @RequirePermissions({ module: 'notifications', screen: 'my', action: 'update' })
  @Patch('read-all')
  markAllRead(@CurrentTenant() tenantId: string) {
    // userId would typically come from auth context; using tenantId as placeholder
    return this.notificationsService.markAllRead(tenantId, tenantId);
  }
}
