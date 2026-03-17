import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';

/**
 * Middleware that extracts tenant ID from JWT payload
 * and sets the PostgreSQL session variable for Row Level Security.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly dataSource: DataSource) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const user = (req as any).user;
    if (user?.tenantId) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.query(`SET app.current_tenant = '${user.tenantId}'`);
      await queryRunner.release();
    }
    next();
  }
}
