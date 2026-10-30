import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectProductDto {
  @ApiPropertyOptional({
    example: 'Product images do not match the description.',
    maxLength: 500,
    description: 'Shared with the vendor in the rejection notification.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(500)
  reason?: string;
}
