import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';

/**
 * Legacy middleware, not registered: middleware runs before authentication,
 * so `req.user` is never set here, and a session variable set on a separate
 * pooled connection does not reach the queries of the request. The tenant
 * row-level-security setting is applied by TransactionInterceptor instead.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly dataSource: DataSource) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const user = (req as any).user;
    if (user?.tenantId) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.query(`SELECT set_config('app.current_tenant', $1, false)`, [
        user.tenantId,
      ]);
      await queryRunner.release();
    }
    next();
  }
}
