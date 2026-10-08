import { Controller, Get, Patch, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from '../services/notifications.service';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @RequirePermissions({ module: 'notifications', screen: 'my', action: 'read' })
  @Get('my')
  getMyNotifications(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.notificationsService.findByUser(tenantId, user.sub);
  }

  @RequirePermissions({ module: 'notifications', screen: 'my', action: 'read' })
  @Get('my/unread-count')
  async unreadCount(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return { count: await this.notificationsService.countUnread(tenantId, user.sub) };
  }

  @RequirePermissions({ module: 'notifications', screen: 'my', action: 'update' })
  @Patch('read-all')
  markAllRead(@CurrentTenant() tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.notificationsService.markAllRead(tenantId, user.sub);
  }

  @RequirePermissions({ module: 'notifications', screen: 'my', action: 'update' })
  @Patch(':id/read')
  markAsRead(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markAsRead(tenantId, id, user.sub);
  }
}
