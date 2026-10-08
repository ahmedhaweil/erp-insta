import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import { Observable, from } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import { AuditLog } from '../entities/audit-log.entity';
import {
  PERMISSIONS_KEY,
  PermissionRequirement,
} from '@common/decorators/require-permissions.decorator';

const SENSITIVE_KEY = /pass(word)?|secret|token|private.?key|pem|otp|code$/i;
const MAX_DEPTH = 6;

/** Removes credentials from request bodies before they are stored. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface AuditQuery {
  userId?: string;
  module?: string;
  recordId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  record(entry: Partial<AuditLog> & { tenantId: string; userId: string }): Promise<AuditLog> {
    return this.auditRepo.save(this.auditRepo.create(entry));
  }

  find(tenantId: string, query: AuditQuery): Promise<AuditLog[]> {
    const where: FindOptionsWhere<AuditLog> = { tenantId };
    if (query.userId) where.userId = query.userId;
    if (query.module) where.module = query.module;
    if (query.recordId) where.recordId = query.recordId;
    if (query.from || query.to) {
      where.createdAt = Between(
        new Date(query.from ?? '1970-01-01'),
        new Date(query.to ? `${query.to}T23:59:59.999Z` : '9999-12-31'),
      );
    }
    return this.auditRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(Number(query.limit) || 200, 1000),
    });
  }
}

/**
 * Audit trail: every successful create/update/delete/action request made by
 * an authenticated user is recorded (who, when, from where, which record,
 * with the redacted request body). Reads are not logged.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (request.method === 'GET' || !user?.tenantId || !user?.sub) return next.handle();

    const permissions = this.reflector.getAllAndOverride<PermissionRequirement[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const controllerPath: string =
      this.reflector.get<string>('path', context.getClass()) ?? context.getClass().name;
    const handler = context.getHandler().name;

    return next.handle().pipe(
      concatMap((result: any) =>
        from(
          this.auditService
            .record({
              tenantId: user.tenantId,
              userId: user.sub,
              action: `${request.method} ${handler}`,
              module: permissions?.[0]?.module ?? controllerPath.split('/')[0],
              recordType: controllerPath,
              recordId: this.recordId(request.params?.id ?? result?.id),
              newValue: redact(request.body ?? null) as Record<string, any>,
              ipAddress: request.ip,
              userAgent: request.headers?.['user-agent']?.slice(0, 255),
            })
            .then(
              () => result,
              (err) => {
                // Auditing must never turn a successful operation into a failure
                this.logger.error(`Audit log write failed: ${err?.message ?? err}`);
                return result;
              },
            ),
        ),
      ),
    );
  }

  private recordId(value: unknown): string | undefined {
    return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
  }
}
