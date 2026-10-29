import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ProductStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ProductsService } from './products.service';

describe('ProductsService product management', () => {
  const buildService = (
    overrides: Record<string, unknown> = {},
  ) => {
    const prisma = {
      product: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        ...((overrides.product as object | undefined) ?? {}),
      },
      order: { count: jest.fn().mockResolvedValue(0) },
      orderItem: { count: jest.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    return {
      prisma,
      service: new ProductsService(prisma, {} as RedisService),
    };
  };

  it('lets a vendor edit only their own products and returns them to pending approval', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'product-1',
      name: 'Updated',
      status: ProductStatus.PENDING,
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
});
