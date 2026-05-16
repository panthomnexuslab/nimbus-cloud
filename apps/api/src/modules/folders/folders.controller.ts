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
  Post,
  Query,
} from '@nestjs/common';
import { FoldersService } from './folders.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AccessTokenPayload } from '../../common/types/auth.types';
import {
  CreateFolderDto,
  MoveFolderDto,
  RenameFolderDto,
  ToggleFavoriteDto,
} from './dto/folder.dto';

@Controller('folders')
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query('parentId') parentId?: string,
  ) {
    return this.folders.list(user.sub, parentId || null);
  }

  @Post()
  create(@CurrentUser() user: AccessTokenPayload, @Body() dto: CreateFolderDto) {
    return this.folders.create(user.sub, dto.name, dto.parentId ?? null);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenameFolderDto,
  ) {
    return this.folders.rename(user.sub, id, dto.name);
  }

  @Patch(':id/move')
  move(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MoveFolderDto,
  ) {
    return this.folders.move(user.sub, id, dto.parentId ?? null);
  }

  @Patch(':id/favorite')
  toggleFavorite(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ToggleFavoriteDto,
  ) {
    return this.folders.toggleFavorite(user.sub, id, dto.favorite);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.folders.softDelete(user.sub, id);
  }
}
