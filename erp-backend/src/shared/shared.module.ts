import { Global, Module } from '@nestjs/common';
import { CacheService } from './services/cache.service';
import { FileStorageService } from './services/file-storage.service';

@Global()
@Module({
  providers: [CacheService, FileStorageService],
  exports: [CacheService, FileStorageService],
})
export class SharedModule {}
