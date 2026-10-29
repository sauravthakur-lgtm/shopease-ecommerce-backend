import { BadRequestException } from '@nestjs/common';
import { Coupon, CouponDiscountType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CouponsService } from './coupons.service';

const createCoupon = (overrides: Partial<Coupon> = {}): Coupon => ({
  id: 'coupon-id',
  code: 'WELCOME10',
  discountType: CouponDiscountType.PERCENTAGE,
  discountValue: new Prisma.Decimal('25'),
  minimumOrderAmount: null,
  maximumDiscountAmount: new Prisma.Decimal('100'),
  expiresAt: new Date(Date.now() + 60_000),
  maxTotalUses: 10,
  maxUsesPerCustomer: 2,
  currentUsageCount: 0,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('CouponsService.validate', () => {
  const setup = (coupon: Coupon, customerUses = 0) => {
    const prisma = {
      coupon: {
        findUnique: jest.fn().mockResolvedValue(coupon),
      },
      order: {
        count: jest.fn().mockResolvedValue(customerUses),
      },
    } as unknown as PrismaService;

    return new CouponsService(prisma);
  };

  it('caps percentage discounts and returns a cent-accurate final amount', async () => {
    const service = setup(createCoupon());

    await expect(
      service.validate('WELCOME10', 1000, 'customer-id'),
    ).resolves.toMatchObject({
      success: true,
      discountAmount: '100.00',
      finalAmount: '900.00',
    });
  });

  it('never applies a fixed discount above the eligible order amount', async () => {
    const coupon = createCoupon({
      discountType: CouponDiscountType.FIXED,
      discountValue: new Prisma.Decimal('75'),
      maximumDiscountAmount: null,
    });
    const service = setup(coupon);

    await expect(
      service.validate('WELCOME10', 50, 'customer-id'),
    ).resolves.toMatchObject({
      discountAmount: '50.00',
      finalAmount: '0.00',
    });
  });

  it.each([
    ['inactive', createCoupon({ isActive: false }), 0, 'Coupon is inactive'],
    [
      'expired',
      createCoupon({ expiresAt: new Date(Date.now() - 60_000) }),
      0,
      'Coupon has expired',
    ],
    [
      'below the minimum',
      createCoupon({
        minimumOrderAmount: new Prisma.Decimal('1500'),
      }),
      0,
      'Order amount does not meet the coupon minimum',
    ],
    [
      'at its global limit',
      createCoupon({ currentUsageCount: 10 }),
      0,
      'Coupon usage limit has been reached',
    ],
    [
      'at the customer limit',
      createCoupon(),
      2,
      'You have reached the usage limit for this coupon',
    ],
  ])(
    'rejects a coupon that is %s',
    async (_scenario, coupon, uses, message) => {
      const service = setup(coupon, uses);

      await expect(
        service.validate('WELCOME10', 1000, 'customer-id'),
      ).rejects.toThrow(new BadRequestException(message));
    },
  );
});
