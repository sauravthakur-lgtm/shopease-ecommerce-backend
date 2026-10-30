import { ForbiddenException } from '@nestjs/common';
import {
  NotificationType,
  OrderStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ProductsService } from '../products/products.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AdminService } from './admin.service';
import { createInMemoryNotificationsPrisma } from '../../test/support/in-memory-notifications';

function setup() {
  const store = createInMemoryNotificationsPrisma();
  let clock = Date.parse('2026-10-30T08:00:00.000Z');
  const tick = () => new Date((clock += 1000));

  let orderStatus: OrderStatus = OrderStatus.PENDING;
  let orderUpdatedAt = tick();
  let productStatus: ProductStatus = ProductStatus.PENDING;
  let productUpdatedAt = tick();
  let vendorActive = false;
  let vendorUpdatedAt = tick();

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    order: {
      findUnique: jest.fn(async () => ({
        id: 'order-1',
        customerId: 'customer-1',
        status: orderStatus,
        updatedAt: orderUpdatedAt,
        couponId: null,
        quantity: 1,
        totalAmount: new Prisma.Decimal('40.00'),
        customer: { name: 'Asha', email: 'asha@example.com' },
        items: [],
        product: { name: 'Desk Lamp' },
      })),
      update: jest.fn(async ({ data }: { data: { status: OrderStatus } }) => {
        orderStatus = data.status;
        orderUpdatedAt = tick();
        return { id: 'order-1', status: orderStatus, updatedAt: orderUpdatedAt };
      }),
    },
    product: {
      // Emulates PostgreSQL conditional updates: the WHERE is re-checked per call.
      updateMany: jest.fn(
        async ({ where, data }: { where: { status: ProductStatus }; data: { status: ProductStatus } }) => {
          if (productStatus !== where.status) return { count: 0 };
          productStatus = data.status;
          productUpdatedAt = tick();
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'product-1',
        name: 'Desk Lamp',
        description: null,
        price: new Prisma.Decimal('40.00'),
        stock: 5,
        status: productStatus,
        imageUrl: null,
        vendorId: 'vendor-owner',
        updatedAt: productUpdatedAt,
      })),
    },
    user: {
      updateMany: jest.fn(async () => {
        if (vendorActive) return { count: 0 };
        vendorActive = true;
        vendorUpdatedAt = tick();
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'vendor-owner',
        name: 'Lamp Co',
        email: 'vendor@example.com',
        role: 'VENDOR',
        isActive: vendorActive,
        updatedAt: vendorUpdatedAt,
      })),
    },
    notification: store.prisma.notification,
  };
  const prisma = {
    product: {
      findUnique: jest.fn(async () => ({
        id: 'product-1',
        status: productStatus,
        vendor: { isActive: true },
      })),
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: 'vendor-owner',
        role: 'VENDOR',
        isActive: vendorActive,
      })),
    },
    $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
  };
  const mailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminService(
    prisma as unknown as PrismaService,
    mailService as unknown as MailService,
    {} as ProductsService,
    new NotificationsService(prisma as unknown as PrismaService),
  );

  return {
    service,
    store,
    tx,
    mailService,
    setProductStatus: (status: ProductStatus) => {
      productStatus = status;
    },
  };
}

describe('AdminService order status notifications', () => {
  it('notifies the order customer when the status actually changes', async () => {
    const { service, store, mailService } = setup();

    await expect(
      service.updateOrderStatus('order-1', { status: OrderStatus.SHIPPED }),
    ).resolves.toMatchObject({ success: true, order: { status: OrderStatus.SHIPPED } });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: 'customer-1',
      type: NotificationType.ORDER_STATUS_CHANGED,
      data: {
        orderId: 'order-1',
        previousStatus: OrderStatus.PENDING,
        status: OrderStatus.SHIPPED,
      },
    });
    expect(store.rows[0].dedupeKey).toMatch(/^order-status:order-1:\d+:SHIPPED$/);
    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('does not notify when the status is unchanged', async () => {
    const { service, store } = setup();

    await service.updateOrderStatus('order-1', { status: OrderStatus.PENDING });

    expect(store.rows).toHaveLength(0);
  });

  it('notifies each distinct transition, including a return to an earlier status', async () => {
    const { service, store, mailService } = setup();

    await service.updateOrderStatus('order-1', { status: OrderStatus.CONFIRMED });
    await service.updateOrderStatus('order-1', { status: OrderStatus.SHIPPED });
    await service.updateOrderStatus('order-1', { status: OrderStatus.CONFIRMED });

    expect(store.rows.map((row) => (row.data as { status: string }).status)).toEqual([
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
      OrderStatus.CONFIRMED,
    ]);
    expect(new Set(store.rows.map((row) => row.dedupeKey)).size).toBe(3);
    // The existing confirmation email is preserved.
    expect(mailService.sendEmail).toHaveBeenCalledTimes(2);
  });
});

describe('AdminService product review notifications', () => {
  it('notifies the product vendor on approval and preserves the response', async () => {
    const { service, store } = setup();

    const result = await service.approveProduct('product-1');

    expect(result).toMatchObject({
      success: true,
      message: 'Product approved successfully',
      product: { id: 'product-1', status: ProductStatus.APPROVED, vendorId: 'vendor-owner' },
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: 'vendor-owner',
      type: NotificationType.PRODUCT_APPROVED,
      data: { productId: 'product-1', status: ProductStatus.APPROVED },
    });
  });

  it('does not duplicate approval notifications for concurrent or repeated approvals', async () => {
    const { service, store } = setup();

    const results = await Promise.allSettled([
      service.approveProduct('product-1'),
      service.approveProduct('product-1'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected && rejected.reason).toBeInstanceOf(ForbiddenException);
    await expect(service.approveProduct('product-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(store.rows).toHaveLength(1);
  });

  it('rejects a pending product and notifies its vendor with the optional reason', async () => {
    const { service, store } = setup();

    const result = await service.rejectProduct('product-1', {
      reason: 'Images are blurry.',
    });

    expect(result).toMatchObject({
      success: true,
      message: 'Product rejected successfully',
      product: { status: ProductStatus.REJECTED },
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: 'vendor-owner',
      type: NotificationType.PRODUCT_REJECTED,
      data: {
        productId: 'product-1',
        status: ProductStatus.REJECTED,
        reason: 'Images are blurry.',
      },
    });
    expect(store.rows[0].message).toContain('Images are blurry.');
  });

  it('rejects without a reason and refuses to review non-pending products', async () => {
    const { service, store, setProductStatus } = setup();

    await service.rejectProduct('product-1', {});
    expect(store.rows[0].data).toEqual({
      productId: 'product-1',
      status: ProductStatus.REJECTED,
    });

    await expect(service.rejectProduct('product-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.approveProduct('product-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    setProductStatus(ProductStatus.APPROVED);
    await expect(service.rejectProduct('product-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(store.rows).toHaveLength(1);
  });
});

describe('AdminService vendor approval notifications', () => {
  it('notifies the vendor once and keeps the existing response shape', async () => {
    const { service, store } = setup();

    const result = await service.approveVendor('vendor-owner');
    await expect(service.approveVendor('vendor-owner')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(result).toEqual({
      success: true,
      message: 'Vendor approved successfully',
      vendor: {
        id: 'vendor-owner',
        name: 'Lamp Co',
        email: 'vendor@example.com',
        role: 'VENDOR',
        isActive: true,
      },
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      userId: 'vendor-owner',
      type: NotificationType.VENDOR_APPROVED,
      data: { vendorId: 'vendor-owner' },
    });
  });

  it('does not duplicate vendor approval notifications for concurrent approvals', async () => {
    const { service, store, tx } = setup();
    // Both requests pass the pre-check before either commits.
    const results = await Promise.allSettled([
      service.approveVendor('vendor-owner'),
      service.approveVendor('vendor-owner'),
    ]);

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'vendor-owner', role: 'VENDOR', isActive: false },
      data: { isActive: true },
    });
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(store.rows).toHaveLength(1);
  });
});
