import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesDownloadService } from './files-download.service';
import {
  ListFilesQueryDto,
  MoveFileDto,
  RenameFileDto,
  ToggleFavoriteDto,
  UpdateTagsDto,
} from './dto/files.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Client, type ClientContext } from '../../common/decorators/client-context.decorator';
import type { AccessTokenPayload } from '../../common/types/auth.types';
import { AppConfigService } from '../../config/app-config.service';

@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly downloads: FilesDownloadService,
    private readonly cfg: AppConfigService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AccessTokenPayload,
    @Query() q: ListFilesQueryDto,
  ) {
    return this.files.list({
      ownerId: user.sub,
      folderId: q.folderId ?? undefined,
      search: q.search,
      favorites: q.favorites,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
      take: q.take,
      cursor: q.cursor,
    });
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    const file = await this.files.getById(user.sub, id);
    return this.files.serialise(file);
  }

  @Get(':id/download-url')
  async downloadUrl(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Client() client: ClientContext,
    @Query('attachment') attachment?: string,
  ) {
    return this.downloads.signDownloadUrl({
      userId: user.sub,
      fileId: id,
      asAttachment: attachment === 'true',
      client,
    });
  }

  @Patch(':id')
  async rename(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenameFileDto,
  ) {
    const file = await this.files.rename(user.sub, id, dto.name);
    return this.files.serialise(file);
  }

  @Patch(':id/move')
  async move(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MoveFileDto,
  ) {
    const file = await this.files.move(user.sub, id, dto.folderId ?? null);
    return this.files.serialise(file);
  }

  @Patch(':id/favorite')
  async favorite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ToggleFavoriteDto,
  ) {
    const file = await this.files.toggleFavorite(user.sub, id, dto.favorite);
    return this.files.serialise(file);
  }

  @Patch(':id/tags')
  async tags(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTagsDto,
  ) {
    const file = await this.files.updateTags(user.sub, id, dto.tags);
    return this.files.serialise(file);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async softDelete(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.files.softDelete(user.sub, id, {
      purgeAfterDays: this.cfg.recycleBinPurgeDays,
    });
  }
}
