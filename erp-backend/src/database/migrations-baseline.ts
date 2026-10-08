import 'reflect-metadata';
import dataSource from '../config/typeorm.config';

/**
 * For databases created by `synchronize` (the development seed) before they
 * were managed by migrations: such a schema already matches the entities of
 * the code it was synchronized from, so every migration of that code is
 * recorded as applied without running it. Later migrations then apply
 * normally with `migration:run`.
 *
 * Run it with the same code version the database was last synchronized
 * from:  npm run migration:baseline && npm run migration:run
 * It does nothing on an empty database (use migration:run).
 */
async function run() {
  await dataSource.initialize();
  const [{ exists }] = await dataSource.query(`SELECT to_regclass('public.sequences') IS NOT NULL AS exists`);
  if (!exists) {
    console.log('Empty database: nothing to baseline, run migration:run');
    await dataSource.destroy();
    return;
  }
  await dataSource.query(
    `CREATE TABLE IF NOT EXISTS migrations (id SERIAL PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)`,
  );
  const recorded = new Set<string>(
    (await dataSource.query(`SELECT name FROM migrations`)).map((r: { name: string }) => r.name),
  );
  const pending = dataSource.migrations
    .map((m) => (m as { name?: string }).name ?? m.constructor.name)
    .filter((name) => !recorded.has(name))
    .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));
  for (const name of pending) {
    await dataSource.query(`INSERT INTO migrations (timestamp, name) VALUES ($1, $2)`, [Number(name.replace(/\D/g, '')), name]);
    console.log(`Recorded ${name} as applied`);
  }
  if (!pending.length) console.log('All migrations are already recorded');
  await dataSource.destroy();
}

run().catch((err) => {
  console.error('Baseline failed:', err);
  process.exit(1);
});
