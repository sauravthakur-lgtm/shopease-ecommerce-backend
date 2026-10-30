import { BadRequestException } from '@nestjs/common';
import { NotificationType, OrderStatus, Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CouponsService } from '../coupons/coupons.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from './orders.service';

describe('OrdersService order placement notifications', () => {
  const product = {
    id: 'product-1',
    name: 'Desk Lamp',
    price: new Prisma.Decimal('25.00'),
    stock: 10,
    status: ProductStatus.APPROVED,
  };

  const setup = () => {
    const tx = {
      product: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(product),
      },
      order: {
        create: jest.fn(({ data }: { data: { customerId: string; totalAmount: Prisma.Decimal } }) =>
          Promise.resolve({
            id: 'order-1',
            customerId: data.customerId,
            status: OrderStatus.PENDING,
            totalAmount: data.totalAmount,
            quantity: 2,
            product: { id: product.id, name: product.name, price: product.price },
            items: [{ quantity: 2, product: { name: product.name } }],
          }),
        ),
      },
      cartItem: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(product) },
      cart: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'cart-1',
          items: [{ productId: product.id, quantity: 2, product }],
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ name: 'Asha', email: 'asha@example.com' }),
      },
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
    };
    const mailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const notificationsService = { create: jest.fn().mockResolvedValue(1) };
    const service = new OrdersService(
      prisma as unknown as PrismaService,
      mailService as unknown as MailService,
      {} as CouponsService,
      notificationsService as unknown as NotificationsService,
    );
    return { tx, prisma, mailService, notificationsService, service };
  };

  const expectedOrderPlaced = expect.objectContaining({
    userId: 'jwt-customer',
    type: NotificationType.ORDER_PLACED,
    data: { orderId: 'order-1', status: OrderStatus.PENDING },
    dedupeKey: 'order-placed:order-1',
  });

  it('notifies the authenticated customer inside the single-product order transaction', async () => {
    const { tx, service, notificationsService } = setup();

    await expect(
      service.createOrder('jwt-customer', { productId: product.id, quantity: 2 }),
    ).resolves.toMatchObject({ success: true, message: 'Order placed successfully' });

    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(notificationsService.create).toHaveBeenCalledWith(tx, expectedOrderPlaced);
  });

  it('notifies the authenticated customer inside the cart checkout transaction', async () => {
    const { tx, service, notificationsService } = setup();

    await expect(service.checkout('jwt-customer')).resolves.toMatchObject({
      success: true,
    });

    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(notificationsService.create).toHaveBeenCalledWith(tx, expectedOrderPlaced);
    expect(tx.cartItem.deleteMany).toHaveBeenCalled();
  });

  it('creates no notification when the single-product order transaction fails', async () => {
    const { tx, service, notificationsService, mailService } = setup();
    tx.product.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createOrder('jwt-customer', { productId: product.id, quantity: 2 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.order.create).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('creates no notification when the cart checkout transaction fails', async () => {
    const { tx, service, notificationsService } = setup();
    tx.order.create.mockRejectedValue(new Error('insert failed'));

    await expect(service.checkout('jwt-customer')).rejects.toThrow('insert failed');
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('fails the order (rolling back the transaction) if its notification cannot be stored', async () => {
    const { service, notificationsService, mailService } = setup();
    notificationsService.create.mockRejectedValue(new Error('notification insert failed'));

    await expect(
      service.createOrder('jwt-customer', { productId: product.id, quantity: 2 }),
    ).rejects.toThrow('notification insert failed');
    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });
});
