import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto/create-order.dto';
import { ProductStatus, Prisma } from '@prisma/client';
import { MailService } from '../mail/mail.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
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

    const totalAmount = product.price.mul(dto.quantity);

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

      return tx.order.create({
        data: {
          customerId,
          productId: product.id,
          quantity: dto.quantity,
          totalAmount: new Prisma.Decimal(totalAmount),
        },
        include: {
          product: {
            select: { id: true, name: true, price: true },
          },
        },
      });
    });

  
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
  async checkout(customerId: string) {
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

  const totalAmount = cart.items.reduce(
    (total, item) =>
      total.add(item.product.price.mul(item.quantity)),
    new Prisma.Decimal(0),
  );

  const order = await this.prisma.$transaction(async (tx) => {
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
    }

    const newOrder = await tx.order.create({
      data: {
        customerId,
        productId: cart.items[0].productId,
        quantity: cart.items[0].quantity,
        totalAmount,
        items: {
          create: cart.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            priceAtPurchase: item.product.price,
          })),
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

  return {
    success: true,
    message: 'Order placed successfully',
    order,
  };
}
}