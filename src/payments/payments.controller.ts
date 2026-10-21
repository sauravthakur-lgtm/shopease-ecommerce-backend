import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';

@ApiTags('Payments')
@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
@ApiBearerAuth('access-token')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-order')
  @ApiOperation({
    summary: 'Create a Razorpay order for an existing customer order',
  })
  @ApiResponse({ status: 201, description: 'Razorpay order created' })
  @ApiResponse({ status: 400, description: 'Invalid order ID' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Customer role required' })
  createOrder(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreatePaymentOrderDto,
  ) {
    return this.paymentsService.createOrder(req.user.userId, dto.orderId);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify Razorpay payment signature' })
  @ApiResponse({ status: 201, description: 'Payment verified' })
  @ApiResponse({
    status: 400,
    description: 'Invalid payment data or signature',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Customer role required' })
  verifyPayment(
    @Req() req: AuthenticatedRequest,
    @Body() dto: VerifyPaymentDto,
  ) {
    return this.paymentsService.verifyPayment(req.user.userId, dto);
  }
}
