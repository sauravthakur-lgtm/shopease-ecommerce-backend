import {
  BadRequestException,
  INestApplication,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { NotificationType, OrderStatus, Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import request from 'supertest';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { createInMemoryNotificationsPrisma } from '../../test/support/in-memory-notifications';

const KEY_SECRET = 'test_key_secret';
const WEBHOOK_SECRET = 'test_webhook_secret';
const RAZORPAY_ORDER_ID = 'order_rzp_1';
const PAYMENT_ID = 'pay_1';

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('hex');

function setup(options: { webhookSecret?: string } = { webhookSecret: WEBHOOK_SECRET }) {
  const store = createInMemoryNotificationsPrisma();
  const config: Record<string, string | undefined> = {
    RAZORPAY_KEY_ID: 'rzp_test_key',
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: options.webhookSecret,
  };
  const configService = {
    get: jest.fn((key: string) => config[key]),
    getOrThrow: jest.fn((key: string) => config[key]),
  };

  let orderStatus: OrderStatus = OrderStatus.PENDING;
  const order = {
    id: 'order-1',
    customerId: 'customer-1',
    totalAmount: new Prisma.Decimal('100.00'),
  };
  const tx = {
    order: {
      // Emulates PostgreSQL row locking: only the first conditional update matches.
      updateMany: jest.fn(async () => {
        if (orderStatus !== OrderStatus.PENDING) return { count: 0 };
        orderStatus = OrderStatus.CONFIRMED;
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async () => ({
        ...order,
        status: orderStatus,
        customer: { name: 'Asha', email: 'asha@example.com' },
        product: { name: 'Desk Lamp' },
      })),
    },
    notification: store.prisma.notification,
  };
  const prisma = {
    order: {
      findFirst: jest.fn(async () => ({ ...order, status: orderStatus })),
      findUnique: jest.fn(async () => ({
        id: order.id,
        customerId: order.customerId,
        status: orderStatus,
      })),
    },
    notification: store.prisma.notification,
    $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
  };
  const razorpay = {
    orders: {
      fetch: jest.fn().mockResolvedValue({ id: RAZORPAY_ORDER_ID, receipt: order.id }),
    },
    payments: {
      fetch: jest.fn().mockResolvedValue({
        id: PAYMENT_ID,
        order_id: RAZORPAY_ORDER_ID,
        status: 'captured',
        currency: 'INR',
        amount: 10000,
      }),
    },
  };
  const mailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const notificationsService = new NotificationsService(
    prisma as unknown as PrismaService,
  );
  const createNotification = jest.spyOn(notificationsService, 'create');

  const service = new PaymentsService(
    configService as unknown as ConfigService,
    prisma as unknown as PrismaService,
    mailService as unknown as MailService,
    notificationsService,
  );
  Object.assign(service, { razorpay });

  return {
    service,
    store,
    tx,
    prisma,
    razorpay,
    mailService,
    createNotification,
    setOrderStatus: (status: OrderStatus) => {
      orderStatus = status;
    },
  };
}

const verifyDto = (signature = sign(`${RAZORPAY_ORDER_ID}|${PAYMENT_ID}`, KEY_SECRET)) => ({
  razorpay_order_id: RAZORPAY_ORDER_ID,
  razorpay_payment_id: PAYMENT_ID,
  razorpay_signature: signature,
});

describe('PaymentsService payment success notifications', () => {
  it('creates no notification for an invalid Razorpay signature', async () => {
    const { service, store, razorpay, createNotification } = setup();

    await expect(
      service.verifyPayment('customer-1', verifyDto('00'.repeat(32))),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(razorpay.orders.fetch).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });

  it('creates no success notification when the payment is not captured or amounts differ', async () => {
    for (const payment of [
      { status: 'authorized', amount: 10000 },
      { status: 'captured', amount: 500 },
    ]) {
      const { service, store, razorpay, tx } = setup();
      razorpay.payments.fetch.mockResolvedValue({
        order_id: RAZORPAY_ORDER_ID,
        currency: 'INR',
        ...payment,
      });

      await expect(
        service.verifyPayment('customer-1', verifyDto()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.order.updateMany).not.toHaveBeenCalled();
      expect(store.rows).toHaveLength(0);
    }
  });

  it('confirms the order and creates exactly one success notification for its customer', async () => {
    const { service, store, tx, mailService } = setup();

    const result = await service.verifyPayment('customer-1', verifyDto());

    expect(result).toMatchObject({
      success: true,
      message: 'Payment verified and order confirmed successfully',
      order: {
        id: 'order-1',
        status: OrderStatus.CONFIRMED,
        customer: { name: 'Asha', email: 'asha@example.com' },
        product: { name: 'Desk Lamp' },
      },
    });
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: 'customer-1',
      type: NotificationType.PAYMENT_SUCCEEDED,
      dedupeKey: `payment-succeeded:${PAYMENT_ID}`,
      data: { orderId: 'order-1', status: OrderStatus.CONFIRMED },
    });
    expect(JSON.stringify(store.rows[0])).not.toContain('asha@example.com');
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate success notifications for concurrent or repeated verification', async () => {
    const { service, store, mailService } = setup();

    const results = await Promise.allSettled([
      service.verifyPayment('customer-1', verifyDto()),
      service.verifyPayment('customer-1', verifyDto()),
    ]);
    const repeated = service.verifyPayment('customer-1', verifyDto());

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected && rejected.reason).toBeInstanceOf(BadRequestException);
    await expect(repeated).rejects.toThrow('Order is not pending');
    expect(store.rows).toHaveLength(1);
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('never stores a second success notification for the same Razorpay payment', async () => {
    const { service, store, setOrderStatus } = setup();

    await service.verifyPayment('customer-1', verifyDto());
    // An admin moving the order back to PENDING must not let the same payment notify twice.
    setOrderStatus(OrderStatus.PENDING);
    await service.verifyPayment('customer-1', verifyDto());

    expect(store.rows).toHaveLength(1);
  });
});

describe('PaymentsService Razorpay webhook', () => {
  const failedEvent = (paymentId = PAYMENT_ID) =>
    JSON.stringify({
      entity: 'event',
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: RAZORPAY_ORDER_ID,
            status: 'failed',
            error_description: 'Card declined',
          },
        },
      },
    });

  it('rejects webhooks while RAZORPAY_WEBHOOK_SECRET is not configured', async () => {
    const { service, razorpay } = setup({ webhookSecret: undefined });
    const body = failedEvent();

    await expect(
      service.handleWebhook(Buffer.from(body), sign(body, WEBHOOK_SECRET)),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(razorpay.orders.fetch).not.toHaveBeenCalled();
  });

  it('rejects missing, invalid, or body-mismatched signatures without side effects', async () => {
    const { service, store, razorpay } = setup();
    const body = failedEvent();
    const tampered = failedEvent('pay_other');

    for (const [rawBody, signature] of [
      [Buffer.from(body), undefined],
      [undefined, sign(body, WEBHOOK_SECRET)],
      [Buffer.from(body), sign(body, 'wrong_secret')],
      [Buffer.from(body), 'not-hex'],
      [Buffer.from(tampered), sign(body, WEBHOOK_SECRET)],
    ] as Array<[Buffer | undefined, string | undefined]>) {
      await expect(service.handleWebhook(rawBody, signature)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }

    expect(razorpay.orders.fetch).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });

  it('maps a verified payment.failed event through the Razorpay order receipt and notifies once', async () => {
    const { service, store, razorpay } = setup();
    const body = failedEvent();
    const signature = sign(body, WEBHOOK_SECRET);

    const first = await service.handleWebhook(Buffer.from(body), signature);
    const redelivery = await service.handleWebhook(Buffer.from(body), signature);

    expect(first).toEqual({ success: true, message: 'Payment failure processed' });
    expect(redelivery).toEqual(first);
    expect(razorpay.orders.fetch).toHaveBeenCalledWith(RAZORPAY_ORDER_ID);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: 'customer-1',
      type: NotificationType.PAYMENT_FAILED,
      dedupeKey: `payment-failed:${PAYMENT_ID}`,
      data: { orderId: 'order-1', status: OrderStatus.PENDING },
    });
  });

  it('ignores verified failures it cannot map or that no longer apply', async () => {
    const unmapped = setup();
    unmapped.razorpay.orders.fetch.mockResolvedValue({ id: RAZORPAY_ORDER_ID });
    const paid = setup();
    paid.setOrderStatus(OrderStatus.CONFIRMED);
    const body = failedEvent();

    for (const { service, store } of [unmapped, paid]) {
      await expect(
        service.handleWebhook(Buffer.from(body), sign(body, WEBHOOK_SECRET)),
      ).resolves.toEqual({ success: true, message: 'Webhook event ignored' });
      expect(store.rows).toHaveLength(0);
    }
  });

  it('acknowledges other verified events without processing them', async () => {
    const { service, store, razorpay } = setup();
    const body = JSON.stringify({ event: 'payment.captured', payload: {} });

    await expect(
      service.handleWebhook(Buffer.from(body), sign(body, WEBHOOK_SECRET)),
    ).resolves.toEqual({ success: true, message: 'Webhook event ignored' });
    expect(razorpay.orders.fetch).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });
});

describe('PaymentsWebhookController', () => {
  let app: INestApplication;
  const handleWebhook = jest.fn().mockResolvedValue({
    success: true,
    message: 'Webhook event ignored',
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentsWebhookController],
      providers: [{ provide: PaymentsService, useValue: { handleWebhook } }],
    }).compile();

    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('passes the exact raw body and signature header without requiring a JWT', async () => {
    const body = '{"event": "payment.failed",  "payload":{}}';

    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', 'abc123')
      .send(body)
      .expect(200);

    const [rawBody, signature] = handleWebhook.mock.calls[0] as [Buffer, string];
    expect(rawBody.toString('utf8')).toBe(body);
    expect(signature).toBe('abc123');
  });
});
