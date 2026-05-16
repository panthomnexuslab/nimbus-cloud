import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../config/app-config.service';
import type { AccessTokenPayload } from '../../../common/types/auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(cfg: AppConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: cfg.jwtAccessSecret,
      issuer: cfg.jwtIssuer,
      audience: cfg.jwtAudience,
      algorithms: ['HS512'],
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AccessTokenPayload> {
    return payload;
  }
}
