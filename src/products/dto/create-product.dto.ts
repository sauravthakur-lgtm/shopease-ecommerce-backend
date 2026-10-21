import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsInt,
  Matches,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateProductDto {
  @ApiProperty({ example: 'Wireless Headphones' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Noise-cancelling Bluetooth headphones' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'Electronics', maxLength: 100 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category: string;

  @ApiProperty({ example: 79.99, minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  price: number;

  @ApiProperty({ example: 25, minimum: 0, maximum: 1000000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  stock: number;

  @ApiPropertyOptional({
    example: '/uploads/products/7d9c2d72-11de-4ac4-b66b-30bfb9a7421e.jpg',
  })
  @IsOptional()
  @IsString()
  @Matches(
    /^\/uploads\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/i,
    {
      message:
        'imageUrl must be a product image URL returned by the upload API',
    },
  )
  imageUrl?: string;
}
