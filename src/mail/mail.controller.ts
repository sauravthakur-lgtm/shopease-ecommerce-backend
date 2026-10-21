import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MailService } from './mail.service';
import { SendTestEmailDto } from './dto/send-test-email.dto';

@ApiTags('Mail')
@Controller('mail')
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Post('test')
  @ApiOperation({ summary: 'Send a test email' })
  @ApiResponse({ status: 201, description: 'Test email sent' })
  @ApiResponse({ status: 400, description: 'Invalid recipient email address' })
  async sendTestEmail(@Body() body: SendTestEmailDto) {
    await this.mailService.sendEmail(
      body.to,
      'E-commerce Backend Test Email',
      'Bhai, Nodemailer email service successfully kaam kar rahi hai!',
    );

    return {
      success: true,
      message: 'Test email sent successfully',
    };
  }
}
