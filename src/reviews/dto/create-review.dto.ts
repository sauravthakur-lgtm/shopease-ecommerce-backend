import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  Min,
  Max,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateReviewDto {
  @ApiProperty({
    example: 5,
    minimum: 1,
    maximum: 5,
    description: 'Product rating from 1 to 5 stars',
  })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    example: 'Excellent product!',
    maxLength: 1000,
    description: 'Optional review comment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}