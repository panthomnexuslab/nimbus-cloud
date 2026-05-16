import { IsBoolean, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  displayName?: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  @MaxLength(500)
  avatarUrl?: string;
}

export class UpdateLoginAlertsDto {
  @IsBoolean()
  enabled!: boolean;
}
