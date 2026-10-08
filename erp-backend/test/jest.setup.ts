import { initializeTransactionalContext, StorageDriver } from 'typeorm-transactional';

// Unit tests use mocked repositories: with the context initialised but no
// DataSource registered, code outside a transaction runs unchanged.
initializeTransactionalContext({ storageDriver: StorageDriver.AUTO });
