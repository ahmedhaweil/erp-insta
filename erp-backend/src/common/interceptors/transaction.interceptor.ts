import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { from, lastValueFrom, Observable } from 'rxjs';
import { runInTransaction } from 'typeorm-transactional';

/**
 * Runs every HTTP request in a single database transaction.
 *
 * Business operations touch many tables (invoice, stock, partner balance,
 * journal entry...). Without a transaction a failure half-way left the
 * sub-ledgers and the general ledger out of sync. Now any exception rolls the
 * whole request back.
 *
 * The authenticated tenant is also set as the transaction-local
 * `app.current_tenant` setting, so PostgreSQL row-level security policies
 * keyed on it apply to every statement of the request. `set_config(..., true)`
 * is parameterised and scoped to the transaction, so it can neither be
 * injected into nor leak to the next request using the pooled connection.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest();
    const tenantId: string | undefined = request.user?.tenantId;

    return from(
      runInTransaction(async () => {
        if (tenantId) {
          await this.dataSource.query(`SELECT set_config('app.current_tenant', $1, true)`, [
            tenantId,
          ]);
        }
        return lastValueFrom(next.handle(), { defaultValue: undefined });
      }),
    );
  }
}
