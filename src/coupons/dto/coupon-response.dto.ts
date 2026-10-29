import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CouponDiscountType } from '@prisma/client';

export class CouponResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'WELCOME10' })
  code: string;

  @ApiProperty({ enum: CouponDiscountType })
  discountType: CouponDiscountType;

  @ApiProperty({ example: '10.00' })
  discountValue: string;

  @ApiPropertyOptional({ example: '500.00', nullable: true })
  minimumOrderAmount: string | null;

  @ApiPropertyOptional({ example: '200.00', nullable: true })
  maximumDiscountAmount: string | null;

  @ApiProperty({ format: 'date-time' })
  expiresAt: Date;

  @ApiPropertyOptional({ example: 100, nullable: true })
  maxTotalUses: number | null;

  @ApiPropertyOptional({ example: 1, nullable: true })
  maxUsesPerCustomer: number | null;

  @ApiProperty({ example: 0 })
  currentUsageCount: number;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}

export class CouponResponseWrapperDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ type: CouponResponseDto })
  coupon: CouponResponseDto;
}

export class CouponListResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 2 })
  count: number;

  @ApiProperty({ type: CouponResponseDto, isArray: true })
  coupons: CouponResponseDto[];
}
