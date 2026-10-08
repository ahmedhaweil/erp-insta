import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { runOnTransactionCommit } from 'typeorm-transactional';
import {
  getEntityManagerByDataSourceName,
  getTransactionalContext,
} from 'typeorm-transactional/dist/common';

/** True while the current async context runs inside a database transaction. */
export function inTransaction(): boolean {
  const context = getTransactionalContext();
  return !!context && !!getEntityManagerByDataSourceName(context, 'default');
}

/**
 * Domain events (journal.posted, order.confirmed, stock.adjusted...) describe
 * facts that only exist once the transaction commits. Emitted inside a
 * transaction, they are delivered after the commit and dropped on rollback,
 * so listeners never notify about, or build on, data that was rolled back.
 */
@Injectable()
export class TransactionalEventsService implements OnModuleInit {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  onModuleInit(): void {
    const emitter = this.eventEmitter as EventEmitter2 & { __transactional?: boolean };
    if (emitter.__transactional) return;
    const emit = emitter.emit.bind(emitter);
    emitter.emit = ((event: string | symbol | (string | symbol)[], ...values: unknown[]) => {
      if (inTransaction()) {
        runOnTransactionCommit(() => emit(event, ...values));
        return true;
      }
      return emit(event, ...values);
    }) as EventEmitter2['emit'];
    emitter.__transactional = true;
  }
}
