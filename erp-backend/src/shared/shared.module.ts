import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheService } from './services/cache.service';
import { FileStorageService } from './services/file-storage.service';
import { SequenceService } from './services/sequence.service';
import { TransactionalEventsService } from './services/transactional-events.service';
import { Sequence } from './entities/sequence.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Sequence])],
  providers: [CacheService, FileStorageService, SequenceService, TransactionalEventsService],
  exports: [CacheService, FileStorageService, SequenceService],
})
export class SharedModule {}
