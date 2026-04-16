import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: Redis | null = null;
  private memoryStore = new Map<string, { value: string; expiry?: number }>();
  private useMemory = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get('redis.host');
    if (!host || host === 'disabled') {
      this.logger.warn('Redis not configured – using in-memory cache (not for production)');
      this.useMemory = true;
      return;
    }

    try {
      this.client = new Redis({
        host,
        port: this.configService.get('redis.port'),
        password: this.configService.get('redis.password'),
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 5000);
        this.client!.once('ready', () => { clearTimeout(timeout); resolve(); });
        this.client!.once('error', (err) => { clearTimeout(timeout); reject(err); });
      });

      this.logger.log('Redis connected');
    } catch {
      this.logger.warn('Redis unavailable – falling back to in-memory cache');
      this.client?.disconnect();
      this.client = null;
      this.useMemory = true;
    }
  }

  onModuleDestroy() {
    this.client?.disconnect();
  }

  private tenantKey(tenantId: string, key: string): string {
    return `tenant:${tenantId}:${key}`;
  }

  async get<T>(tenantId: string, key: string): Promise<T | null> {
    const k = this.tenantKey(tenantId, key);
    if (this.useMemory) {
      const entry = this.memoryStore.get(k);
      if (!entry) return null;
      if (entry.expiry && Date.now() > entry.expiry) { this.memoryStore.delete(k); return null; }
      return JSON.parse(entry.value);
    }
    const value = await this.client!.get(k);
    return value ? JSON.parse(value) : null;
  }

  async set(tenantId: string, key: string, value: any, ttlSeconds?: number): Promise<void> {
    const k = this.tenantKey(tenantId, key);
    const serialized = JSON.stringify(value);
    if (this.useMemory) {
      this.memoryStore.set(k, {
        value: serialized,
        expiry: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
      });
      return;
    }
    if (ttlSeconds) {
      await this.client!.setex(k, ttlSeconds, serialized);
    } else {
      await this.client!.set(k, serialized);
    }
  }

  async del(tenantId: string, key: string): Promise<void> {
    const k = this.tenantKey(tenantId, key);
    if (this.useMemory) { this.memoryStore.delete(k); return; }
    await this.client!.del(k);
  }

  async delPattern(tenantId: string, pattern: string): Promise<void> {
    const k = this.tenantKey(tenantId, pattern);
    if (this.useMemory) {
      for (const key of this.memoryStore.keys()) {
        if (key.startsWith(k.replace('*', ''))) this.memoryStore.delete(key);
      }
      return;
    }
    const keys = await this.client!.keys(k);
    if (keys.length > 0) {
      await this.client!.del(...keys);
    }
  }

  getClient(): Redis | null {
    return this.client;
  }
}
