import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.client = new Redis({
      host: this.configService.get('redis.host'),
      port: this.configService.get('redis.port'),
      password: this.configService.get('redis.password'),
    });
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }

  private tenantKey(tenantId: string, key: string): string {
    return `tenant:${tenantId}:${key}`;
  }

  async get<T>(tenantId: string, key: string): Promise<T | null> {
    const value = await this.client.get(this.tenantKey(tenantId, key));
    return value ? JSON.parse(value) : null;
  }

  async set(tenantId: string, key: string, value: any, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.setex(this.tenantKey(tenantId, key), ttlSeconds, serialized);
    } else {
      await this.client.set(this.tenantKey(tenantId, key), serialized);
    }
  }

  async del(tenantId: string, key: string): Promise<void> {
    await this.client.del(this.tenantKey(tenantId, key));
  }

  async delPattern(tenantId: string, pattern: string): Promise<void> {
    const keys = await this.client.keys(this.tenantKey(tenantId, pattern));
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  getClient(): Redis {
    return this.client;
  }
}
