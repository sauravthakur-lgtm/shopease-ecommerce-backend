
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async addToCart(
    customerId: string,
    productId: string,
    quantity: number,
  ) {
    // Step 1: Check database connection
    const dbInfo = await this.prisma.$queryRaw<
      { database: string; user_count: bigint }[]
    >`
      SELECT
        current_database() AS database,
        (SELECT COUNT(*) FROM "User") AS user_count
    `;

    console.log('Cart database info:', dbInfo);

    // Step 2: Find customer by ID
    const customer = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    console.log('Customer from Prisma:', customer);
    console.log('Customer ID from JWT:', customerId);

    // Temporary diagnostic lookup by email
    const emailCheck = await this.prisma.user.findUnique({
      where: { email: 'carttest@example.com' },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    console.log('Customer lookup by email:', emailCheck);

    if (!customer) {
      throw new NotFoundException('Customer not found in database');
    }

    if (customer.role !== 'CUSTOMER') {
      throw new BadRequestException(
        'Only customers can use the cart',
      );
    }

    // Step 3: Validate quantity
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException(
        'Quantity must be at least 1',
      );
    }

    // Step 4: Find approved product
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product || product.status !== 'APPROVED') {
      throw new NotFoundException('Approved product not found');
    }

    // Step 5: Find or create cart
    const cart = await this.prisma.cart.upsert({
      where: { customerId },
      update: {},
      create: { customerId },
    });

    // Step 6: Add product or increase quantity
    return this.prisma.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
      update: {
        quantity: { increment: quantity },
      },
      create: {
        cartId: cart.id,
        productId,
        quantity,
      },
      include: {
        product: true,
      },
    });
  }
  // get cart items for cusrtomer
  async getCart(customerId: string) {
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

  if (!cart) {
    return {
      message: 'Your cart is empty',
      items: [],
    };
  }

  return cart;
}

async updateCartItem(customerId: string, productId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new BadRequestException('Quantity must be at least 1');
  }

  const cart = await this.prisma.cart.findUnique({
    where: { customerId },
  });

  if (!cart) {
    throw new NotFoundException('Cart not found');
  }

  const cartItem = await this.prisma.cartItem.findUnique({
    where: {
      cartId_productId: {
        cartId: cart.id,
        productId,
      },
    },
    include: {
      product: true,
    },
  });

  if (!cartItem) {
    throw new NotFoundException('Product not found in your cart');
  }

  if (
    quantity > cartItem.quantity &&
    quantity > cartItem.product.stock
  ) {
    throw new BadRequestException(
      `Only ${cartItem.product.stock} units are currently available`,
    );
  }

  return this.prisma.cartItem.update({
    where: {
      cartId_productId: {
        cartId: cart.id,
        productId,
      },
    },
    data: { quantity },
    include: {
      product: true,
    },
  });
}

//  remove product from cart 
async removeFromCart(customerId: string, productId: string) {
  const cart = await this.prisma.cart.findUnique({
    where: { customerId },
  });

  if (!cart) {
    throw new NotFoundException('Cart not found');
  }

  const cartItem = await this.prisma.cartItem.findUnique({
    where: {
      cartId_productId: {
        cartId: cart.id,
        productId,
      },
    },
  });

  if (!cartItem) {
    throw new NotFoundException('Product not found in your cart');
  }

  await this.prisma.cartItem.delete({
    where: {
      cartId_productId: {
        cartId: cart.id,
        productId,
      },
    },
  });

  return {
    message: 'Product removed from cart successfully',
  };
}

}
