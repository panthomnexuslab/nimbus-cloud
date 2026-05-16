import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class ListFilesQueryDto {
  @IsOptional()
  @IsUUID('4')
  folderId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  search?: string;

  @IsOptional()
  @IsBoolean()
  favorites?: boolean;

  @IsOptional()
  @IsIn(['name', 'createdAt', 'updatedAt', 'sizeBytes'])
  sortBy?: 'name' | 'createdAt' | 'updatedAt' | 'sizeBytes';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}

export class RenameFileDto {
  @IsString()
  @Length(1, 255)
  name!: string;
}

export class MoveFileDto {
  @IsOptional()
  @IsUUID('4')
  folderId?: string | null;
}

export class ToggleFavoriteDto {
  @IsBoolean()
  favorite!: boolean;
}

export class UpdateTagsDto {
  @IsArray()
  @IsString({ each: true })
  tags!: string[];
}
