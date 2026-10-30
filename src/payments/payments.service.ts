import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { MailService } from '../mail/mail.service';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  paymentFailedNotification,
  paymentSucceededNotification,
} from '../notifications/notification-events';

interface RazorpayWebhookEvent {
  event?: unknown;
  payload?: {
    payment?: {
      entity?: {
        id?: unknown;
        order_id?: unknown;
      };
    };
  };
}

function isValidHmacSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
) {
  const expected = Buffer.from(
    createHmac('sha256', secret).update(payload).digest('hex'),
    'hex',
  );
  const received = Buffer.from(signature, 'hex');

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private razorpay: Razorpay;
constructor(
  private configService: ConfigService,
  private prisma: PrismaService,
  private mailService: MailService,
  private notificationsService: NotificationsService,
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

  const confirmedOrder = await this.prisma.$transaction(async (tx) => {
    // Conditional update: concurrent or repeated verifications cannot confirm
    // the same order (or create its success notification) twice.
    const confirmation = await tx.order.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });

    if (confirmation.count === 0) {
      throw new BadRequestException('Order is not pending');
    }

    const updatedOrder = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
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

    await this.notificationsService.create(
      tx,
      paymentSucceededNotification(updatedOrder, razorpay_payment_id),
    );

    return updatedOrder;
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

async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
  const secret = this.configService.get<string>('RAZORPAY_WEBHOOK_SECRET');
  if (!secret) {
    this.logger.error('Razorpay webhook rejected: RAZORPAY_WEBHOOK_SECRET is not configured.');
    throw new ServiceUnavailableException('Payment webhook is not configured');
  }

  // The signature covers the exact bytes Razorpay sent, so verify before parsing.
  if (!rawBody || !signature || !isValidHmacSignature(rawBody, signature, secret)) {
    throw new BadRequestException('Invalid webhook signature');
  }

  let webhookEvent: RazorpayWebhookEvent;
  try {
    webhookEvent = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookEvent;
  } catch {
    throw new BadRequestException('Invalid webhook payload');
  }

  if (webhookEvent?.event !== 'payment.failed') {
    return { success: true, message: 'Webhook event ignored' };
  }

  const payment = webhookEvent.payload?.payment?.entity;
  if (typeof payment?.id !== 'string' || typeof payment.order_id !== 'string') {
    this.logger.warn('Ignored payment.failed webhook without a Razorpay order reference.');
    return { success: true, message: 'Webhook event ignored' };
  }

  // Same mapping as /payments/verify: the Razorpay order receipt is our order ID,
  // read back from Razorpay rather than from the webhook body.
  const razorpayOrder = await this.razorpay.orders.fetch(payment.order_id);
  const databaseOrderId = razorpayOrder.receipt;
  const order = databaseOrderId
    ? await this.prisma.order.findUnique({
        where: { id: databaseOrderId },
        select: { id: true, customerId: true, status: true },
      })
    : null;

  if (!order) {
    this.logger.warn(
      `Ignored payment.failed webhook for payment ${payment.id}: no matching order.`,
    );
    return { success: true, message: 'Webhook event ignored' };
  }

  // A failure for an order that has since been paid or cancelled is not actionable.
  if (order.status !== 'PENDING') {
    return { success: true, message: 'Webhook event ignored' };
  }

  await this.notificationsService.create(
    this.prisma,
    paymentFailedNotification(order, payment.id),
  );

  return { success: true, message: 'Payment failure processed' };
}
}
