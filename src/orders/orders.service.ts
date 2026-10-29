import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto/create-order.dto';
import { ProductStatus, Prisma } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { CouponsService } from '../coupons/coupons.service';
import { CheckoutCouponDto } from '../coupons/dto/checkout-coupon.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly couponsService: CouponsService,
  ) {}

  async createOrder(customerId: string, dto: CreateOrderDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.status !== ProductStatus.APPROVED) {
      throw new BadRequestException(
        'This product is not available for ordering',
      );
    }

    if (product.stock < dto.quantity) {
      throw new BadRequestException('Insufficient stock');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const stockUpdate = await tx.product.updateMany({
        where: {
          id: product.id,
          stock: { gte: dto.quantity },
          status: ProductStatus.APPROVED,
        },
        data: {
          stock: { decrement: dto.quantity },
        },
      });

      if (stockUpdate.count === 0) {
        throw new BadRequestException(
          'Product is unavailable or insufficient stock',
        );
      }

      const currentProduct = await tx.product.findUnique({
        where: { id: product.id },
      });
      if (!currentProduct) {
        throw new NotFoundException('Product not found');
      }
      const subtotal = currentProduct.price.mul(dto.quantity);

      const coupon = dto.couponCode
        ? await this.couponsService.reserveForOrder(
            tx,
            dto.couponCode,
            subtotal,
            customerId,
          )
        : undefined;

      return tx.order.create({
        data: {
          customerId,
          productId: product.id,
          quantity: dto.quantity,
          totalAmount: coupon?.totalAmount ?? subtotal,
          couponId: coupon?.couponId,
          couponCode: coupon?.couponCode,
          discountAmount: coupon?.discountAmount ?? new Prisma.Decimal(0),
        },
        include: {
          product: {
            select: { id: true, name: true, price: true },
          },
        },
      });
    });

    await this.sendOrderConfirmation(
      customerId,
      order.id,
      order.status,
      order.totalAmount,
      [{ productName: order.product.name, quantity: order.quantity }],
    );

    return {
      success: true,
      message: 'Order placed successfully',
      order,
    };
  }

  async getMyOrders(customerId: string) {
    const orders = await this.prisma.order.findMany({
      where: { customerId },
    include: {
  product: {
    select: {
      id: true,
      name: true,
      price: true,
    },
  },
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
        },
      },
    },
  },
},
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      success: true,
      count: orders.length,
      orders,
    };
  }
  async checkout(customerId: string, dto?: CheckoutCouponDto) {
  const cart = await this.prisma.cart.findUnique({
    where: { customerId },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  });

  if (!cart || cart.items.length === 0) {
    throw new BadRequestException('Your cart is empty');
  }

  for (const item of cart.items) {
    if (item.product.status !== ProductStatus.APPROVED) {
      throw new BadRequestException(
        `${item.product.name} is not available for ordering`,
      );
    }

    if (item.product.stock < item.quantity) {
      throw new BadRequestException(
        `Insufficient stock for ${item.product.name}`,
      );
    }
  }

  const order = await this.prisma.$transaction(async (tx) => {
    const purchasedItems: Array<{
      productId: string;
      quantity: number;
      priceAtPurchase: Prisma.Decimal;
    }> = [];
    let subtotal = new Prisma.Decimal(0);

    for (const item of cart.items) {
      const stockUpdate = await tx.product.updateMany({
        where: {
          id: item.productId,
          stock: { gte: item.quantity },
          status: ProductStatus.APPROVED,
        },
        data: {
          stock: { decrement: item.quantity },
        },
      });

      if (stockUpdate.count === 0) {
        throw new BadRequestException(
          `Product ${item.product.name} is unavailable or stock is insufficient`,
        );
      }

      const currentProduct = await tx.product.findUnique({
        where: { id: item.productId },
        select: { price: true },
      });
      if (!currentProduct) {
        throw new BadRequestException(
          `Product ${item.product.name} is unavailable`,
        );
      }
      subtotal = subtotal.add(currentProduct.price.mul(item.quantity));
      purchasedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        priceAtPurchase: currentProduct.price,
      });
    }

    const coupon = dto?.couponCode
      ? await this.couponsService.reserveForOrder(
          tx,
          dto.couponCode,
          subtotal,
          customerId,
        )
      : undefined;

    const newOrder = await tx.order.create({
      data: {
        customerId,
        productId: cart.items[0].productId,
        quantity: cart.items[0].quantity,
        totalAmount: coupon?.totalAmount ?? subtotal,
        couponId: coupon?.couponId,
        couponCode: coupon?.couponCode,
        discountAmount: coupon?.discountAmount ?? new Prisma.Decimal(0),
        items: {
          create: purchasedItems,
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    await tx.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    return newOrder;
  });

  await this.sendOrderConfirmation(
    customerId,
    order.id,
    order.status,
    order.totalAmount,
    order.items.map((item) => ({
      productName: item.product.name,
      quantity: item.quantity,
    })),
  );

  return {
    success: true,
    message: 'Order placed successfully',
    order,
  };
}

  private async sendOrderConfirmation(
    customerId: string,
    orderId: string,
    status: string,
    totalAmount: Prisma.Decimal,
    items: Array<{ productName: string; quantity: number }>,
  ) {
    try {
      const customer = await this.prisma.user.findUnique({
        where: { id: customerId },
        select: { name: true, email: true },
      });

      if (!customer) {
        throw new Error(`Customer ${customerId} was not found`);
      }

      const itemDetails = items
        .map((item) => `- ${item.productName}: quantity ${item.quantity}`)
        .join('\n');
      const text = [
        `Hello ${customer.name},`,
        '',
        'Your order has been placed successfully.',
        `Order ID: ${orderId}`,
        'Products:',
        itemDetails,
        `Total amount: ${totalAmount.toString()}`,
        `Order status: ${status}`,
      ].join('\n');

      await this.mailService.sendEmail(
        customer.email,
        'Your ShopEase order confirmation',
        text,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send confirmation email for order ${orderId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}