import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ProductsService } from '../products/products.service';
import { AdminService } from './admin.service';
import { ProductStatus } from '@prisma/client';

describe('AdminService.deactivateVendor', () => {
  const createService = (
    vendor: { id: string; role: string; isActive: boolean } | null,
  ) => {
    const userUpdate = jest.fn();
    const productUpdateMany = jest.fn();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(vendor) },
      $transaction: jest.fn(async (callback: (transaction: unknown) => unknown) =>
        callback({
          user: { update: userUpdate },
          product: { updateMany: productUpdateMany },
        }),
      ),
    } as unknown as PrismaService;
    const service = new AdminService(
      prisma,
      {} as MailService,
      {} as ProductsService,
    );
    return { prisma, service, userUpdate, productUpdateMany };
  };

  it('deactivates the vendor and moves approved products to pending inside a transaction', async () => {
    const { prisma, service, userUpdate, productUpdateMany } = createService({
      id: 'vendor-1',
      role: 'VENDOR',
      isActive: true,
    });

    await expect(service.deactivateVendor('vendor-1')).resolves.toMatchObject({
      success: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'vendor-1' },
      data: { isActive: false },
    });
    expect(productUpdateMany).toHaveBeenCalledWith({
      where: { vendorId: 'vendor-1', status: ProductStatus.APPROVED },
      data: { status: ProductStatus.PENDING },
    });
  });

  it('does not deactivate a non-vendor account', async () => {
    const { service, prisma } = createService({
      id: 'customer-1',
      role: 'CUSTOMER',
      isActive: true,
    });

    await expect(service.deactivateVendor('customer-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
