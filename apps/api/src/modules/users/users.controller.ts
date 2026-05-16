import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../common/types/auth.types';
import { UpdateLoginAlertsDto, UpdateProfileDto } from './dto/update-profile.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AccessTokenPayload) {
    const u = await this.users.findById(user.sub);
    return {
      ...u,
      storageQuotaBytes: u.storageQuotaBytes?.toString() ?? null,
      storageUsedBytes: u.storageUsedBytes.toString(),
      twoFactorEnabled: u.twoFactor?.enabled ?? false,
    };
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpdateProfileDto) {
    await this.users.updateProfile(user.sub, dto);
    return this.users.findById(user.sub);
  }

  @Patch('me/login-alerts')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setLoginAlerts(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpdateLoginAlertsDto) {
    await this.users.setLoginAlerts(user.sub, dto.enabled);
  }
}
