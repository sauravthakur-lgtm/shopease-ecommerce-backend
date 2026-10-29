import { ApiProperty } from '@nestjs/swagger';

export class CouponValidationResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'WELCOME10' })
  code: string;

  @ApiProperty({ example: 'PERCENTAGE', enum: ['PERCENTAGE', 'FIXED'] })
  discountType: string;

  @ApiProperty({ example: '10.00' })
  discountValue: string;

  @ApiProperty({ example: '120.00' })
  discountAmount: string;

  @ApiProperty({ example: '1080.00' })
  finalAmount: string;
}
