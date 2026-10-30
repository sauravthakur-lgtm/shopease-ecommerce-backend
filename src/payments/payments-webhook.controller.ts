import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentsService } from './payments.service';

// Razorpay calls this without a JWT, so it is kept out of PaymentsController's
// guards and authenticated by the X-Razorpay-Signature header instead.
@ApiTags('Payments')
@Controller('payments')
export class PaymentsWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive Razorpay webhook events',
    description:
      'Verifies X-Razorpay-Signature against the raw request body using RAZORPAY_WEBHOOK_SECRET. Only payment.failed events are processed; other verified events are acknowledged and ignored.',
  })
  @ApiHeader({ name: 'X-Razorpay-Signature', required: true })
  @ApiResponse({ status: 200, description: 'Webhook processed or ignored' })
  @ApiResponse({ status: 400, description: 'Invalid signature or payload' })
  @ApiResponse({ status: 503, description: 'Webhook secret is not configured' })
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
  ) {
    return this.paymentsService.handleWebhook(req.rawBody, signature);
  }
}
