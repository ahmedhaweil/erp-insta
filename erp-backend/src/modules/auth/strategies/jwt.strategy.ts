import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '@common/interfaces/request-with-user.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload & { requires2fa?: boolean }): Promise<JwtPayload> {
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException('Invalid token payload');
    }
    // The short-lived token issued after the password step of a 2FA login is
    // signed with the same secret; it must never work as an access token.
    if (payload.requires2fa) {
      throw new UnauthorizedException('Two-factor authentication is not completed');
    }
    return payload;
  }
}
