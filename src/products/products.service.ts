import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { Prisma, ProductStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { readFile, unlink } from 'node:fs/promises';
import { basename } from 'node:path';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(vendorId: string, dto: CreateProductDto) {
    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        description: dto.description,
        imageUrl: dto.imageUrl ?? null,
        category: dto.category.trim(),
        price: new Prisma.Decimal(dto.price),
        stock: dto.stock, 
        vendorId,
        status: ProductStatus.PENDING,    
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        stock: true,
        status: true,
        imageUrl: true,
        category: true,
        vendorId: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      message: 'Product created successfully. Waiting for admin approval.',
      product,
    };
  }

  async uploadProductImage(file?: Express.Multer.File) {
    const imageUrl = await this.validateAndGetImageUrl(file);

    return {
      success: true,
      imageUrl,
    };
  }

  async validateAndGetImageUrl(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('An image file is required.');
    }

    const content = await readFile(file.path);
    const validSignatures: Record<string, boolean> = {
      'image/jpeg':
        content.length >= 3 &&
        content[0] === 0xff &&
        content[1] === 0xd8 &&
        content[2] === 0xff,
      'image/png':
        content.length >= 8 &&
        content.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
      'image/webp':
        content.length >= 12 &&
        content.toString('ascii', 0, 4) === 'RIFF' &&
        content.toString('ascii', 8, 12) === 'WEBP',
      'image/gif':
        content.length >= 6 &&
        ['GIF87a', 'GIF89a'].includes(content.toString('ascii', 0, 6)),
    };

    if (!validSignatures[file.mimetype]) {
      await unlink(file.path);
      throw new BadRequestException(
        'The uploaded file contents do not match a supported image type.',
      );
    }

    return `/uploads/products/${basename(file.filename)}`;
  }

  async getMyProducts(vendorId: string) {
    const products = await this.prisma.product.findMany({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      success: true,
      count: products.length,
      products,
    };
  }

  async getApprovedProducts(category?: string, query?: string) {
    return this.listApprovedProducts(category, query);
  }

  async getProductsByCategory(category: string, query?: string) {
    const normalizedCategory = category.trim();
    if (!normalizedCategory) {
      throw new BadRequestException('A product category is required.');
    }

    return this.listApprovedProducts(normalizedCategory, query);
  }

  async getProductCategories() {
    const categories = await this.prisma.product.findMany({
      where: {
        status: ProductStatus.APPROVED,
        category: { not: null },
      },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    const names = categories.flatMap((product) =>
      product.category === null ? [] : [product.category],
    );

    return {
      success: true,
      count: names.length,
      categories: names,
    };
  }

  async searchProducts(query: string, category?: string) {
    if (!query.trim() && !category?.trim()) {
      return {
        success: true,
        count: 0,
        products: [],
      };
    }

    return this.listApprovedProducts(category, query);
  }

  private async listApprovedProducts(category?: string, query?: string) {
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.APPROVED,
    };
    const normalizedCategory = category?.trim();
    const normalizedQuery = query?.trim();

    if (normalizedCategory) {
      where.category = {
        equals: normalizedCategory,
        mode: 'insensitive',
      };
    }

    if (normalizedQuery) {
      where.OR = [
        { name: { contains: normalizedQuery, mode: 'insensitive' } },
        { description: { contains: normalizedQuery, mode: 'insensitive' } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        stock: true,
        status: true,
        imageUrl: true,
        category: true,
        vendor: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return {
      success: true,
      count: products.length,
      products,
    };
  }
  async getRecommendedProducts(limit = 8) {
    const safeLimit = Math.min(Math.max(Math.floor(limit) || 8, 1), 50);

    const approvedProducts = await this.prisma.product.findMany({
      where: {
        status: ProductStatus.APPROVED,
        stock: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        stock: true,
        imageUrl: true,
        category: true,
        createdAt: true,
      },
    });

    const soldQuantities = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          status: 'DELIVERED',
        },
        product: {
          status: ProductStatus.APPROVED,
          stock: { gt: 0 },
        },
      },
      _sum: {
        quantity: true,
      },
    });

    const salesMap = new Map(
      soldQuantities.map((item) => [
        item.productId,
        item._sum.quantity ?? 0,
      ]),
    );

    const products = approvedProducts
      .map((product) => ({
        ...product,
        soldQuantity: salesMap.get(product.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.soldQuantity - a.soldQuantity ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      )
      .slice(0, safeLimit);

    return {
      success: true,
      count: products.length,
      products,
    };
  }
  async getProductById(id: string) {
  const product = await this.prisma.product.findFirst({
    where: {
      id,
      status: ProductStatus.APPROVED,
    },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      stock: true,
      status: true,
      imageUrl: true,
      category: true,
      createdAt: true,
      updatedAt: true,
      vendor: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  if (!product) {
    const { NotFoundException } = await import('@nestjs/common');
    throw new NotFoundException('Product not found.');
  }

  return {
    success: true,
    product,
  };
}
}