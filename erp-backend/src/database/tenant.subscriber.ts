import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
  LoadEvent,
} from 'typeorm';

/**
 * TypeORM subscriber that sets the PostgreSQL session variable
 * for Row Level Security (RLS) tenant isolation.
 *
 * This is used in conjunction with the TenantContextMiddleware
 * which stores the current tenant ID on the query runner.
 */
@EventSubscriber()
export class TenantSubscriber implements EntitySubscriberInterface {
  async beforeInsert(event: InsertEvent<any>): Promise<void> {
    await this.setTenantContext(event);
  }

  async beforeUpdate(event: UpdateEvent<any>): Promise<void> {
    await this.setTenantContext(event);
  }

  private async setTenantContext(
    event: InsertEvent<any> | UpdateEvent<any> | LoadEvent<any>,
  ): Promise<void> {
    const tenantId = (event.queryRunner as any)?.data?.tenantId;
    if (tenantId) {
      await event.queryRunner.query(`SET app.current_tenant = '${tenantId}'`);
    }
  }
}
