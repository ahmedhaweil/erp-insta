export abstract class BaseEvent {
  readonly timestamp: Date;
  readonly tenantId: string;
  readonly userId: string;

  constructor(tenantId: string, userId: string) {
    this.timestamp = new Date();
    this.tenantId = tenantId;
    this.userId = userId;
  }
}
