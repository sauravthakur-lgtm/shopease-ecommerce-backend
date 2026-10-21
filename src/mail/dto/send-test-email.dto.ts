import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class SendTestEmailDto {
  @ApiProperty({ example: 'recipient@example.com' })
  @IsEmail()
  to: string;
}
