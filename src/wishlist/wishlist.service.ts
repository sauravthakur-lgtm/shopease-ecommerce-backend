import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  async addToWishlist(customerId: string, productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product || product.status !== 'APPROVED') {
      throw new NotFoundException('Approved product not found');
    }

    const existingItem = await this.prisma.wishlistItem.findUnique({
      where: {
        customerId_productId: {
          customerId,
          productId,
        },
      },
    });

    if (existingItem) {
      throw new ConflictException('Product already in wishlist');
    }

    return this.prisma.wishlistItem.create({
      data: {
        customerId,
        productId,
      },
      include: {
        product: true,
      },
    });
  }
  async getWishlist(customerId: string) {
  return this.prisma.wishlistItem.findMany({
    where: { customerId },
    include: {
      product: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}
async removeFromWishlist(customerId: string, productId: string) {
  const item = await this.prisma.wishlistItem.findUnique({
    where: {
      customerId_productId: {
        customerId,
        productId,
      },
    },
  });

  if (!item) {
    throw new NotFoundException('Product not found in wishlist');
  }

  await this.prisma.wishlistItem.delete({
    where: {
      customerId_productId: {
        customerId,
        productId,
      },
    },
  });

  return {
    message: 'Product removed from wishlist successfully',
  };
}
}