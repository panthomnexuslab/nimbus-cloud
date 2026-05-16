import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Invalid email' })
  @MaxLength(254)
  email!: string;

  /** Strong password requirement: ≥12 chars, mix of classes. */
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters' })
  @MaxLength(200)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9])/, {
    message: 'Password must contain upper, lower, number, and symbol',
  })
  password!: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  displayName?: string;
}
