import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddToWishlistDto {
  @ApiProperty({ example: '7d9c2d72-11de-4ac4-b66b-30bfb9a7421e' })
  @IsUUID()
  productId: string;
}
