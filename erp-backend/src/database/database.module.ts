import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { addTransactionalDataSource, getDataSourceByName } from 'typeorm-transactional';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('database.host'),
        port: config.get('database.port'),
        username: config.get('database.user'),
        password: config.get('database.password'),
        database: config.get('database.name'),
        ssl: config.get('database.ssl') ? { rejectUnauthorized: false } : false,
        autoLoadEntities: true,
        synchronize: false,
        // DB_RUN_MIGRATIONS=true applies pending migrations at startup.
        migrations: [`${__dirname}/migrations/*{.ts,.js}`],
        migrationsRun: process.env.DB_RUN_MIGRATIONS === 'true',
        logging: config.get('database.logging'),
        subscribers: [],
      }),
      // Registers the DataSource with typeorm-transactional so repositories
      // join the request transaction opened by TransactionInterceptor.
      async dataSourceFactory(options) {
        if (!options) throw new Error('Invalid TypeORM options');
        return (
          getDataSourceByName('default') ||
          addTransactionalDataSource(await new DataSource(options).initialize())
        );
      },
    }),
  ],
})
export class DatabaseModule {}
