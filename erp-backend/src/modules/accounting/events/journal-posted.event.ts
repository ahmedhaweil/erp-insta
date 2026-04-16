import { BaseEvent } from '@shared/events/base.event';

export class JournalPostedEvent extends BaseEvent {
  constructor(
    tenantId: string,
    userId: string,
    public readonly entryId: string,
    public readonly refNumber: string,
    public readonly totalAmount: number,
  ) {
    super(tenantId, userId);
  }
}
