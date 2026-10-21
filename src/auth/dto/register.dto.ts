import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MinLength,
} from 'class-validator';

export enum RegisterRole {
  CUSTOMER = 'CUSTOMER',
  VENDOR = 'VENDOR',
}

export class RegisterDto {
  @ApiProperty({ example: 'Alex Customer' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'alex@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'CustomerPass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: RegisterRole, example: RegisterRole.CUSTOMER })
  @IsEnum(RegisterRole)
  role: RegisterRole;
}
