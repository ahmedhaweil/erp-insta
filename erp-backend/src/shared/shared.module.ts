import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheService } from './services/cache.service';
import { FileStorageService } from './services/file-storage.service';
import { SequenceService } from './services/sequence.service';
import { Sequence } from './entities/sequence.entity';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Sequence])],
  providers: [CacheService, FileStorageService, SequenceService],
  exports: [CacheService, FileStorageService, SequenceService],
})
export class SharedModule {}
