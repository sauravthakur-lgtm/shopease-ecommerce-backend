import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateVendorStockDto {
  @ApiProperty({ minimum: 0, maximum: 1000000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  stock: number;
}
