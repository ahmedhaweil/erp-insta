import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderConfirmedEvent } from '@modules/sales/events/order-confirmed.event';
import { NotificationsService } from '@modules/notifications/services/notifications.service';
import { NotificationType } from '@modules/notifications/entities/notification.entity';

@Injectable()
export class SalesListener {
  private readonly logger = new Logger(SalesListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
  ) {}

  @OnEvent('order.confirmed')
  async handleOrderConfirmed(event: OrderConfirmedEvent) {
    this.logger.log(
      `Sales order ${event.orderNumber} confirmed - Amount: ${event.totalAmount} [Tenant: ${event.tenantId}]`,
    );

    // Notify user
    await this.notificationsService.create(event.tenantId, {
      userId: event.userId,
      title: 'Order Confirmed',
      body: `Sales order ${event.orderNumber} has been confirmed (Total: ${event.totalAmount.toFixed(2)})`,
      type: NotificationType.SUCCESS,
      data: { orderId: event.orderId, orderNumber: event.orderNumber },
    });
  }
}
