import { BaseEvent } from '@shared/events/base.event';

export class OrderConfirmedEvent extends BaseEvent {
  constructor(
    tenantId: string,
    userId: string,
    public readonly orderId: string,
    public readonly orderNumber: string,
    public readonly totalAmount: number,
  ) {
    super(tenantId, userId);
  }
}
