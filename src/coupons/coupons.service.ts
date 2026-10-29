import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Coupon,
  CouponDiscountType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

type CouponTransaction = Prisma.TransactionClient;

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCouponDto) {
    this.validateCouponConfiguration(dto);
    this.validateExpiry(dto.expiresAt);

    try {
      const coupon = await this.prisma.coupon.create({
        data: this.toCreateData(dto),
      });

      return { success: true, coupon };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A coupon with this code already exists');
      }
      throw error;
    }
  }

  async findAll() {
    const coupons = await this.prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return { success: true, count: coupons.length, coupons };
  }

  async findOne(id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }
    return { success: true, coupon };
  }

  async update(id: string, dto: UpdateCouponDto) {
    try {
      const coupon = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${id} FOR UPDATE`;
        const existing = await tx.coupon.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException('Coupon not found');
        }

        const effective = {
          discountType: dto.discountType ?? existing.discountType,
          discountValue: dto.discountValue ?? Number(existing.discountValue),
          minimumOrderAmount:
            dto.minimumOrderAmount === undefined
              ? existing.minimumOrderAmount === null
                ? undefined
                : Number(existing.minimumOrderAmount)
              : (dto.minimumOrderAmount ?? undefined),
          maximumDiscountAmount:
            dto.maximumDiscountAmount === undefined
              ? existing.maximumDiscountAmount === null
                ? undefined
                : Number(existing.maximumDiscountAmount)
              : (dto.maximumDiscountAmount ?? undefined),
        };
        this.validateCouponConfiguration(effective);

        if (dto.expiresAt !== undefined) {
          this.validateExpiry(dto.expiresAt);
        }

        const nextMaxUses =
          dto.maxTotalUses === undefined
            ? existing.maxTotalUses
            : dto.maxTotalUses;
        if (
          nextMaxUses !== null &&
          nextMaxUses !== undefined &&
          nextMaxUses < existing.currentUsageCount
        ) {
          throw new BadRequestException(
            'Maximum total uses cannot be less than the number of reserved uses',
          );
        }

        return tx.coupon.update({
          where: { id },
          data: this.toUpdateData(dto),
        });
      });
      return { success: true, coupon };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('A coupon with this code already exists');
      }
      throw error;
    }
  }

  async deactivate(id: string) {
    const updated = await this.prisma.coupon.updateMany({
      where: { id },
      data: { isActive: false },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Coupon not found');
    }
    return { success: true, message: 'Coupon deactivated successfully' };
  }

  async validate(code: string, orderAmount: number, customerId: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    const amount = new Prisma.Decimal(String(orderAmount));
    const discount = await this.checkCoupon(
      this.prisma,
      coupon,
      amount,
      customerId,
    );

    return {
      success: true,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue.toFixed(2),
      discountAmount: discount.toFixed(2),
      finalAmount: amount.sub(discount).toFixed(2),
    };
  }

  async reserveForOrder(
    tx: CouponTransaction,
    code: string,
    orderAmount: Prisma.Decimal,
    customerId: string,
  ) {
    const found = await tx.coupon.findUnique({ where: { code } });
    if (!found) {
      throw new NotFoundException('Coupon not found');
    }

    await tx.$queryRaw`SELECT "id" FROM "Coupon" WHERE "id" = ${found.id} FOR UPDATE`;
    const coupon = await tx.coupon.findUnique({ where: { id: found.id } });
    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    const discount = await this.checkCoupon(
      tx,
      coupon,
      orderAmount,
      customerId,
    );

    await tx.coupon.update({
      where: { id: coupon.id },
      data: { currentUsageCount: { increment: 1 } },
    });

    return {
      couponId: coupon.id,
      couponCode: coupon.code,
      discountAmount: discount,
      totalAmount: orderAmount.sub(discount).toDecimalPlaces(2),
    };
  }

  private async checkCoupon(
    db: Pick<CouponTransaction, 'order'>,
    coupon: Coupon,
    orderAmount: Prisma.Decimal,
    customerId: string,
  ) {
    const now = new Date();
    if (!coupon.isActive) {
      throw new BadRequestException('Coupon is inactive');
    }
    if (coupon.expiresAt <= now) {
      throw new BadRequestException('Coupon has expired');
    }
    if (
      coupon.minimumOrderAmount !== null &&
      orderAmount.lessThan(coupon.minimumOrderAmount)
    ) {
      throw new BadRequestException(
        'Order amount does not meet the coupon minimum',
      );
    }
    if (
      coupon.maxTotalUses !== null &&
      coupon.currentUsageCount >= coupon.maxTotalUses
    ) {
      throw new BadRequestException('Coupon usage limit has been reached');
    }

    if (coupon.maxUsesPerCustomer !== null) {
      const customerUses = await db.order.count({
        where: {
          couponId: coupon.id,
          customerId,
          status: { not: OrderStatus.CANCELLED },
        },
      });
      if (customerUses >= coupon.maxUsesPerCustomer) {
        throw new BadRequestException(
          'You have reached the usage limit for this coupon',
        );
      }
    }

    const discount = this.calculateDiscount(coupon, orderAmount);
    if (discount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Coupon does not provide a valid discount');
    }
    return discount;
  }

  private calculateDiscount(
    coupon: Coupon,
    orderAmount: Prisma.Decimal,
  ): Prisma.Decimal {
    let discount =
      coupon.discountType === CouponDiscountType.PERCENTAGE
        ? orderAmount.mul(coupon.discountValue).div(100).toDecimalPlaces(2)
        : coupon.discountValue;

    if (
      coupon.discountType === CouponDiscountType.PERCENTAGE &&
      coupon.maximumDiscountAmount !== null &&
      discount.greaterThan(coupon.maximumDiscountAmount)
    ) {
      discount = coupon.maximumDiscountAmount;
    }
    if (discount.greaterThan(orderAmount)) {
      discount = orderAmount;
    }
    return discount.toDecimalPlaces(2);
  }

  private validateCouponConfiguration(input: {
    discountType: CouponDiscountType;
    discountValue: number;
    minimumOrderAmount?: number | null;
    maximumDiscountAmount?: number | null;
  }) {
    if (input.discountValue <= 0) {
      throw new BadRequestException('Discount value must be greater than zero');
    }
    if (
      input.discountType === CouponDiscountType.PERCENTAGE &&
      input.discountValue > 100
    ) {
      throw new BadRequestException(
        'Percentage discount cannot exceed 100 percent',
      );
    }
    if (
      input.discountType === CouponDiscountType.FIXED &&
      input.maximumDiscountAmount != null
    ) {
      throw new BadRequestException(
        'Maximum discount amount applies only to percentage coupons',
      );
    }
    if (input.minimumOrderAmount != null && input.minimumOrderAmount < 0) {
      throw new BadRequestException('Minimum order amount cannot be negative');
    }
  }

  private validateExpiry(value: string) {
    if (new Date(value) <= new Date()) {
      throw new BadRequestException('Coupon expiry must be in the future');
    }
  }

  private toCreateData(dto: CreateCouponDto): Prisma.CouponCreateInput {
    return {
      code: dto.code,
      discountType: dto.discountType,
      discountValue: new Prisma.Decimal(String(dto.discountValue)),
      minimumOrderAmount:
        dto.minimumOrderAmount == null
          ? undefined
          : new Prisma.Decimal(String(dto.minimumOrderAmount)),
      maximumDiscountAmount:
        dto.maximumDiscountAmount == null
          ? undefined
          : new Prisma.Decimal(String(dto.maximumDiscountAmount)),
      expiresAt: new Date(dto.expiresAt),
      maxTotalUses: dto.maxTotalUses ?? undefined,
      maxUsesPerCustomer: dto.maxUsesPerCustomer ?? undefined,
      isActive: dto.isActive,
    };
  }

  private toUpdateData(dto: UpdateCouponDto): Prisma.CouponUpdateInput {
    return {
      code: dto.code,
      discountType: dto.discountType,
      discountValue:
        dto.discountValue === undefined
          ? undefined
          : new Prisma.Decimal(String(dto.discountValue)),
      minimumOrderAmount:
        dto.minimumOrderAmount === undefined
          ? undefined
          : dto.minimumOrderAmount === null
            ? null
            : new Prisma.Decimal(String(dto.minimumOrderAmount)),
      maximumDiscountAmount:
        dto.maximumDiscountAmount === undefined
          ? undefined
          : dto.maximumDiscountAmount === null
            ? null
            : new Prisma.Decimal(String(dto.maximumDiscountAmount)),
      expiresAt:
        dto.expiresAt === undefined ? undefined : new Date(dto.expiresAt),
      maxTotalUses: dto.maxTotalUses,
      maxUsesPerCustomer: dto.maxUsesPerCustomer,
      isActive: dto.isActive,
    };
  }

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
