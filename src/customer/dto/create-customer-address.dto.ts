
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCustomerAddressDto {
  @ApiProperty({ example: 'Saurav Thakur' })
  @IsString()
  @MaxLength(100)
  fullName: string;

  @ApiProperty({ example: '9876543210' })
  @IsString()
  @MaxLength(20)
  phone: string;

  @ApiProperty({ example: 'House No. 10, Sector 22' })
  @IsString()
  @MaxLength(200)
  addressLine1: string;

  @ApiPropertyOptional({ example: 'Near Market' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @ApiProperty({ example: 'Chandigarh' })
  @IsString()
  @MaxLength(100)
  city: string;

  @ApiProperty({ example: 'Chandigarh' })
  @IsString()
  @MaxLength(100)
  state: string;

  @ApiProperty({ example: '160022' })
  @IsString()
  @MaxLength(10)
  postalCode: string;

  @ApiPropertyOptional({ example: 'India', default: 'India' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @ApiPropertyOptional({ example: true, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
