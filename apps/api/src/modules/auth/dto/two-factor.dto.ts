import { IsString, Length } from 'class-validator';

export class TwoFactorVerifyDto {
  @IsString()
  @Length(6, 10)
  code!: string;
}

export class TwoFactorDisableDto {
  @IsString()
  @Length(6, 10)
  code!: string;
}
