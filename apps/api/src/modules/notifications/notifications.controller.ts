import { Controller, Get, HttpCode, HttpStatus, Param, Patch, ParseUUIDPipe } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../common/types/auth.types';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AccessTokenPayload) {
    return this.notifications.list(user.sub);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.notifications.markRead(user.sub, id);
  }
}
