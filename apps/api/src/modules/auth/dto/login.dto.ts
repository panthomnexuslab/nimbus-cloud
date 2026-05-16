import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;

  /** Optional TOTP code sent on the same request if 2FA is required. */
  @IsOptional()
  @IsString()
  @Length(6, 10)
  totpCode?: string;

  /** Optional one-time recovery code instead of TOTP. */
  @IsOptional()
  @IsString()
  @Length(8, 32)
  recoveryCode?: string;

  /** Optional human-friendly label for this device (e.g. "Aman's iPhone"). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  deviceName?: string;

  /** If true, mark device as trusted (skips 2FA step-up next time). */
  @IsOptional()
  rememberDevice?: boolean;
}
