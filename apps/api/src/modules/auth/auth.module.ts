import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { TotpService } from './services/totp.service';
import { OAuthService } from './services/oauth.service';
import { SessionService } from './services/session.service';
import { LoginGuard } from './guards/login.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({}),
    AuditModule,
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    TotpService,
    OAuthService,
    SessionService,
    LoginGuard,
    JwtStrategy,
    GoogleStrategy,
    // Global JWT auth on every route except @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // RBAC on @Roles()-annotated routes
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TokenService, SessionService, AuthService, PasswordService],
})
export class AuthModule {}
