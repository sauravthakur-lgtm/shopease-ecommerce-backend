import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ProductsService } from './products.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('ProductsService product management', () => {
  const buildService = (
    overrides: Record<string, unknown> = {},
  ) => {
    const prisma = {
      product: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
        delete: jest.fn(),
        ...((overrides.product as object | undefined) ?? {}),
      },
      order: { count: jest.fn().mockResolvedValue(0) },
      orderItem: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    } as unknown as PrismaService;
    const notificationsService = {
      notifyAdmins: jest.fn().mockResolvedValue(1),
    };
    return {
      prisma,
      notificationsService,
      service: new ProductsService(
        prisma,
        {} as RedisService,
        notificationsService as unknown as NotificationsService,
      ),
    };
  };

  it('lets a vendor edit only their own products and returns them to pending approval', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'product-1',
      name: 'Updated',
      status: ProductStatus.PENDING,
      vendorId: 'vendor-1',
      updatedAt: new Date('2026-10-30T10:00:00.000Z'),
    });
    const { prisma, service } = buildService({
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          vendorId: 'vendor-1',
        }),
        update,
      },
    });

    await service.updateProduct(
      'product-1',
      'vendor-1',
      UserRole.VENDOR,
      { name: 'Updated' },
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Updated',
          status: ProductStatus.PENDING,
        }),
      }),
    );

    (prisma.product.findUnique as jest.Mock).mockResolvedValue({
      id: 'product-1',
      vendorId: 'other-vendor',
    });
    await expect(
      service.updateProduct(
        'product-1',
        'vendor-1',
        UserRole.VENDOR,
        { name: 'Changed' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not mass-assign product status and permits administrators to edit any product', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'product-1',
      status: ProductStatus.APPROVED,
    });
    const { service } = buildService({
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          vendorId: 'vendor-1',
        }),
        update,
      },
    });

    const massAssignedPayload = {
      name: 'Admin update',
      status: ProductStatus.REJECTED,
    };
    await service.updateProduct(
      'product-1',
      'admin-1',
      UserRole.ADMIN,
      massAssignedPayload,
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Admin update' },
      }),
    );
  });

  it('prevents vendors from deleting another vendor product', async () => {
    const deleteProduct = jest.fn();
    const { service } = buildService({
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          vendorId: 'other-vendor',
        }),
        delete: deleteProduct,
      },
    });

    await expect(
      service.deleteProduct('product-1', 'vendor-1', UserRole.VENDOR),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deleteProduct).not.toHaveBeenCalled();
  });

  it('preserves products with order history and deletes unreferenced products', async () => {
    const deleteProduct = jest.fn().mockResolvedValue({ id: 'product-1' });
    const { prisma, service } = buildService({
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          vendorId: 'vendor-1',
        }),
        delete: deleteProduct,
      },
    });

    (prisma.order.count as jest.Mock).mockResolvedValueOnce(1);
    await expect(
      service.deleteProduct('product-1', 'admin-1', UserRole.ADMIN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(deleteProduct).not.toHaveBeenCalled();

    (prisma.order.count as jest.Mock).mockResolvedValueOnce(0);
    await expect(
      service.deleteProduct('product-1', 'admin-1', UserRole.ADMIN),
    ).resolves.toMatchObject({ success: true });
    expect(deleteProduct).toHaveBeenCalledWith({ where: { id: 'product-1' } });
  });

  describe('pending review notifications', () => {
    const updatedAt = new Date('2026-10-30T10:00:00.000Z');
    const vendorEdit = (statusTransitions: number) => {
      const updateMany = jest.fn().mockResolvedValue({ count: statusTransitions });
      const built = buildService({
        product: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'product-1',
            vendorId: 'vendor-1',
          }),
          updateMany,
          update: jest.fn().mockResolvedValue({
            id: 'product-1',
            name: 'Updated',
            vendorId: 'vendor-1',
            status: ProductStatus.PENDING,
            updatedAt,
          }),
        },
      });
      return { ...built, updateMany };
    };

    it('notifies admins inside the creation transaction when a vendor creates a product', async () => {
      const createdAt = new Date('2026-10-30T09:00:00.000Z');
      const { prisma, service, notificationsService } = buildService({
        product: {
          create: jest.fn().mockResolvedValue({
            id: 'product-1',
            name: 'Desk Lamp',
            vendorId: 'vendor-1',
            status: ProductStatus.PENDING,
            createdAt,
          }),
        },
      });

      const transaction = jest.spyOn(prisma, '$transaction');

      await service.createProduct('vendor-1', {
        name: 'Desk Lamp',
        description: 'Warm light',
        category: 'Electronics',
        price: 25,
        stock: 3,
      });

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(notificationsService.notifyAdmins).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          type: 'PRODUCT_PENDING_REVIEW',
          data: { productId: 'product-1', vendorId: 'vendor-1' },
          dedupeKey: `product-review:product-1:${createdAt.getTime()}`,
        }),
      );
    });

    it('does not notify admins when product creation fails', async () => {
      const { service, notificationsService } = buildService({
        product: {
          create: jest.fn().mockRejectedValue(new Error('insert failed')),
        },
      });

      await expect(
        service.createProduct('vendor-1', {
          name: 'Desk Lamp',
          description: 'Warm light',
          category: 'Electronics',
          price: 25,
          stock: 3,
        }),
      ).rejects.toThrow('insert failed');
      expect(notificationsService.notifyAdmins).not.toHaveBeenCalled();
    });

    it('notifies admins when a vendor edit moves a reviewed product back to pending', async () => {
      const { prisma, service, notificationsService, updateMany } = vendorEdit(1);

      await service.updateProduct('product-1', 'vendor-1', UserRole.VENDOR, {
        name: 'Updated',
      });

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'product-1', status: { not: ProductStatus.PENDING } },
        data: { status: ProductStatus.PENDING },
      });
      expect(notificationsService.notifyAdmins).toHaveBeenCalledTimes(1);
      expect(notificationsService.notifyAdmins).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          type: 'PRODUCT_PENDING_REVIEW',
          dedupeKey: `product-review:product-1:${updatedAt.getTime()}`,
        }),
      );
    });

    it('does not notify admins when the edited product was already pending', async () => {
      const { service, notificationsService } = vendorEdit(0);

      await service.updateProduct('product-1', 'vendor-1', UserRole.VENDOR, {
        name: 'Updated',
      });

      expect(notificationsService.notifyAdmins).not.toHaveBeenCalled();
    });

    it('does not notify admins about administrator edits', async () => {
      const { service, notificationsService, updateMany } = vendorEdit(1);

      await service.updateProduct('product-1', 'admin-1', UserRole.ADMIN, {
        name: 'Updated',
      });

      expect(updateMany).not.toHaveBeenCalled();
      expect(notificationsService.notifyAdmins).not.toHaveBeenCalled();
    });
  });
});
