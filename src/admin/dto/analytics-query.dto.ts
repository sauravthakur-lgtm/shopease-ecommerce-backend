import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum SalesPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export class AnalyticsDateRangeDto {
  @ApiPropertyOptional({
    description:
      'Inclusive ISO 8601 timestamp; date-only values begin at 00:00:00 UTC.',
    example: '2026-10-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'Inclusive ISO 8601 timestamp; a date-only value includes the full UTC day.',
    example: '2026-10-28T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString({ strict: true })
  endDate?: string;
}

export class SalesReportQueryDto extends AnalyticsDateRangeDto {
  @ApiPropertyOptional({
    enum: SalesPeriod,
    default: SalesPeriod.DAILY,
    description: 'UTC calendar interval used to group paid order sales.',
  })
  @IsOptional()
  @IsEnum(SalesPeriod)
  period?: SalesPeriod;
}

export class TopProductsQueryDto extends AnalyticsDateRangeDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
