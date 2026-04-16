import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
  branchIds: string[];
  iat: number;
  exp: number;
}

export interface RequestWithUser extends Request {
  user: JwtPayload;
}
