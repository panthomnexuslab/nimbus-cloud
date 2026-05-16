import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../common/types/auth.types';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('me')
  async myLog(
    @CurrentUser() user: AccessTokenPayload,
    @Query('take') take?: string,
  ) {
    const entries = await this.audit.listForUser(user.sub, Number(take ?? 50));
    return { entries };
  }
}
