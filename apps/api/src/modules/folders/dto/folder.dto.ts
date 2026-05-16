import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateFolderDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsUUID('4')
  parentId?: string;
}

export class RenameFolderDto {
  @IsString()
  @Length(1, 255)
  name!: string;
}

export class MoveFolderDto {
  @IsOptional()
  @IsUUID('4')
  parentId?: string | null;
}

export class ToggleFavoriteDto {
  @IsBoolean()
  favorite!: boolean;
}
