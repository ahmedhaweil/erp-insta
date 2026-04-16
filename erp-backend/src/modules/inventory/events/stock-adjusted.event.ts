import { BaseEvent } from '@shared/events/base.event';

export class StockAdjustedEvent extends BaseEvent {
  constructor(
    tenantId: string,
    userId: string,
    public readonly productId: string,
    public readonly warehouseId: string,
    public readonly quantity: number,
    public readonly type: string,
  ) {
    super(tenantId, userId);
  }
}
