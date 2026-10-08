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
 * Not registered: TransactionInterceptor sets the tenant for the whole
 * request transaction.
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
      await event.queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    }
  }
}
