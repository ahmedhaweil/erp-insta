import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PurchaseReceivedEvent } from '@modules/purchasing/events/purchase-received.event';
import { NotificationsService } from '@modules/notifications/services/notifications.service';
import { NotificationType } from '@modules/notifications/entities/notification.entity';

@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent('stock.reorder-alert')
  async handleReorderAlert(event: {
    tenantId: string;
    userId: string;
    productId: string;
    productName: string;
    currentQty: number;
    reorderLevel: number;
    reorderQty: number;
  }) {
    this.logger.warn(
      `Reorder alert: ${event.productName} at ${event.currentQty} units (level: ${event.reorderLevel})`,
    );

    await this.notificationsService.create(event.tenantId, {
      userId: event.userId,
      title: 'Low Stock Alert',
      body: `${event.productName} is below reorder level. Current: ${event.currentQty}, Reorder Level: ${event.reorderLevel}, Suggested Order: ${event.reorderQty}`,
      type: NotificationType.WARNING,
      data: {
        productId: event.productId,
        currentQty: event.currentQty,
        reorderLevel: event.reorderLevel,
        reorderQty: event.reorderQty,
      },
    });
  }

  @OnEvent('purchase.received')
  async handlePurchaseReceived(event: PurchaseReceivedEvent) {
    this.logger.log(
      `Purchase order ${event.orderNumber} confirmed [Tenant: ${event.tenantId}]`,
    );

    await this.notificationsService.create(event.tenantId, {
      userId: event.userId,
      title: 'Purchase Order Confirmed',
      body: `Purchase order ${event.orderNumber} has been confirmed (Total: ${event.totalAmount.toFixed(2)})`,
      type: NotificationType.INFO,
      data: { orderId: event.orderId, orderNumber: event.orderNumber },
    });
  }
}
