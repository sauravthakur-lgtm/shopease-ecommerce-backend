import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { MailService } from '../mail/mail.service';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'crypto';
@Injectable()
export class PaymentsService {
  private razorpay: Razorpay;
constructor(
  private configService: ConfigService,
  private prisma: PrismaService,
  private mailService: MailService,
) {
  this.razorpay = new Razorpay({
    key_id: this.configService.getOrThrow<string>('RAZORPAY_KEY_ID'),
    key_secret: this.configService.getOrThrow<string>('RAZORPAY_KEY_SECRET'),
  });
}
async createOrder(customerId: string, orderId: string) {
  const order = await this.prisma.order.findFirst({
    where: {
      id: orderId,
      customerId: customerId,
    },
  });

  if (!order) {
    throw new NotFoundException(
      'Order not found for this customer',
    );
  }

  if (order.status !== 'PENDING') {
    throw new BadRequestException(
      'Only pending orders can be paid',
    );
  }

  const amountInPaise = Math.round(
    Number(order.totalAmount) * 100,
  );

  if (!Number.isSafeInteger(amountInPaise) || amountInPaise <= 0) {
    throw new BadRequestException('Invalid order amount');
  }

  const razorpayOrder = await this.razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: order.id,
  });

  return {
    orderId: order.id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: this.configService.getOrThrow<string>(
      'RAZORPAY_KEY_ID',
    ),
  };
}
async verifyPayment(
  customerId: string,
  dto: VerifyPaymentDto,
) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = dto;

  const secret = this.configService.getOrThrow<string>(
    'RAZORPAY_KEY_SECRET',
  );

  const expectedSignature = createHmac('sha256', secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const expected = Buffer.from(expectedSignature, 'hex');
  const received = Buffer.from(razorpay_signature, 'hex');

  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    throw new BadRequestException('Invalid payment signature');
  }

  const razorpayOrder = await this.razorpay.orders.fetch(
    razorpay_order_id,
  );

  const databaseOrderId = razorpayOrder.receipt;

  if (!databaseOrderId) {
    throw new BadRequestException('Order reference missing');
  }

  const order = await this.prisma.order.findFirst({
    where: {
      id: databaseOrderId,
      customerId,
    },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  if (order.status !== 'PENDING') {
    throw new BadRequestException('Order is not pending');
  }

  const payment = await this.razorpay.payments.fetch(
    razorpay_payment_id,
  );

  if (
    payment.order_id !== razorpay_order_id ||
    payment.status !== 'captured' ||
    payment.currency !== 'INR' ||
    payment.amount !== Math.round(Number(order.totalAmount) * 100)
  ) {
    throw new BadRequestException(
      'Payment amount, status, or order does not match',
    );
  }

  const confirmedOrder = await this.prisma.order.update({
  where: { id: order.id },
  data: { status: 'CONFIRMED' },
  include: {
    customer: {
      select: {
        name: true,
        email: true,
      },
    },
    product: {
      select: {
        name: true,
      },
    },
  },
});

try {
  await this.mailService.sendEmail(
    confirmedOrder.customer.email,
    'Payment Successful - Order Confirmed',
    `Hi ${confirmedOrder.customer.name},

Your payment has been verified successfully!

Order ID: ${confirmedOrder.id}
Product: ${confirmedOrder.product.name}
Total Amount: Rs. ${confirmedOrder.totalAmount}
Payment ID: ${razorpay_payment_id}
Order Status: ${confirmedOrder.status}

Thank you for shopping with us!`,
  );
} catch (error) {
  console.error('Payment confirmation email could not be sent.');
}

return {
  success: true,
  message: 'Payment verified and order confirmed successfully',
  order: confirmedOrder,
};
}
}
