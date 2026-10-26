import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { Prisma, ProductStatus } from '@prisma/client';
import { readFile, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { RedisService } from '../redis/redis.service';

const approvedProductSelect = {
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
} satisfies Prisma.ProductSelect;

type ApprovedProduct = Prisma.ProductGetPayload<{
  select: typeof approvedProductSelect;
}>;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
  private readonly prisma: PrismaService,
  private readonly redisService: RedisService,
) {}
  // Create product
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

  // Upload product image
  async uploadProductImage(file?: Express.Multer.File) {
    const imageUrl = await this.validateAndGetImageUrl(file);

    return {
      success: true,
      imageUrl,
    };
  }

  // Validate uploaded image
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
        content
          .subarray(0, 8)
          .equals(
            Buffer.from([
              0x89, 0x50, 0x4e, 0x47,
              0x0d, 0x0a, 0x1a, 0x0a,
            ]),
          ),

      'image/webp':
        content.length >= 12 &&
        content.toString('ascii', 0, 4) === 'RIFF' &&
        content.toString('ascii', 8, 12) === 'WEBP',

      'image/gif':
        content.length >= 6 &&
        ['GIF87a', 'GIF89a'].includes(
          content.toString('ascii', 0, 6),
        ),
    };

    if (!validSignatures[file.mimetype]) {
      await unlink(file.path);

      throw new BadRequestException(
        'The uploaded file contents do not match a supported image type.',
      );
    }

    return `/uploads/products/${basename(file.filename)}`;
  }

  // Get vendor's own products
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

  // Get approved products
  async getApprovedProducts(category?: string, query?: string) {
    return this.listApprovedProducts(category, query);
  }

  // Get products by category
  async getProductsByCategory(category: string, query?: string) {
    const normalizedCategory = category.trim();

    if (!normalizedCategory) {
      throw new BadRequestException(
        'A product category is required.',
      );
    }

    return this.listApprovedProducts(normalizedCategory, query);
  }

  // Get all available product categories
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

  // Search products and recommend similar products
  async searchProducts(query: string, category?: string) {
    const normalizedQuery = query.trim();
    const normalizedCategory = category?.trim();
    const limit = 8;

    // No search query: return products from the selected category
    if (!normalizedQuery) {
      if (normalizedCategory) {
        return this.listApprovedProducts(normalizedCategory);
      }

      return {
        success: true,
        searchQuery: '',
        count: 0,
        products: [],
      };
    }

    // Split query into useful search terms
    const searchTerms = normalizedQuery
      .split(/\s+/)
      .filter((term) => term.length > 1);

    if (searchTerms.length === 0) {
      searchTerms.push(normalizedQuery);
    }

    const productSelect = {
      id: true,
      name: true,
      description: true,
      price: true,
      stock: true,
      status: true,
      imageUrl: true,
      category: true,
      createdAt: true,
      vendor: {
        select: {
          id: true,
          name: true,
        },
      },
    } satisfies Prisma.ProductSelect;

    // 1. Find direct matches first
    const primaryWhere: Prisma.ProductWhereInput = {
      status: ProductStatus.APPROVED,
      stock: { gt: 0 },
      OR: [
        {
          name: {
            contains: normalizedQuery,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: normalizedQuery,
            mode: 'insensitive',
          },
        },
      ],
    };

    if (normalizedCategory) {
      primaryWhere.category = {
        equals: normalizedCategory,
        mode: 'insensitive',
      };
    }

    const primaryProducts = await this.prisma.product.findMany({
      where: primaryWhere,
      select: productSelect,
    });

    // 2. If fewer than 8 direct matches, find similar products
    let similarProducts: typeof primaryProducts = [];

    if (primaryProducts.length < limit) {
      const similarWhere: Prisma.ProductWhereInput = {
        status: ProductStatus.APPROVED,
        stock: { gt: 0 },
        id: {
          notIn: primaryProducts.map((product) => product.id),
        },
        OR: searchTerms.flatMap((term) => [
          {
            name: {
              contains: term,
              mode: 'insensitive' as const,
            },
          },
          {
            description: {
              contains: term,
              mode: 'insensitive' as const,
            },
          },
          {
            category: {
              contains: term,
              mode: 'insensitive' as const,
            },
          },
        ]),
      };

      // If a category was selected, get fallback products
      // from other categories to fill the results.
    if (normalizedCategory) {
  similarWhere.NOT = {
    category: {
      equals: normalizedCategory,
      mode: 'insensitive',
    },
  };
}

      similarProducts = await this.prisma.product.findMany({
        where: similarWhere,
        select: productSelect,
      });
    }

    // 3. Mark direct matches and fallback recommendations
    const combinedProducts = [
      ...primaryProducts.map((product) => ({
        ...product,
        matchType: 'MATCH' as const,
      })),
      ...similarProducts.map((product) => ({
        ...product,
        matchType: 'SIMILAR' as const,
      })),
    ];

    // 4. Calculate sales using delivered orders
    const soldQuantities = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          status: 'DELIVERED',
        },
        product: {
          status: ProductStatus.APPROVED,
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

    // 5. Rank direct matches first, then by sales, then by price
    const products = combinedProducts
      .map((product) => ({
        ...product,
        soldQuantity: salesMap.get(product.id) ?? 0,
      }))
      .sort((a, b) => {
        if (a.matchType !== b.matchType) {
          return a.matchType === 'MATCH' ? -1 : 1;
        }

        return (
          b.soldQuantity - a.soldQuantity ||
          Number(a.price) - Number(b.price)
        );
      })
      .slice(0, limit);

    return {
      success: true,
      searchQuery: normalizedQuery,
      category: normalizedCategory ?? null,
      count: products.length,
      products,
    };
  }

  // Shared method for listing approved products
  private async listApprovedProducts(
    category?: string,
    query?: string,
  ) {
    const normalizedCategory = category?.trim();
    const normalizedQuery = query?.trim();
    const cacheKey = `products:approved:${JSON.stringify([
      normalizedCategory?.toLowerCase() ?? null,
      normalizedQuery?.toLowerCase() ?? null,
    ])}`;

    try {
      const cachedProducts =
        await this.redisService.get<ApprovedProduct[]>(cacheKey);

      if (cachedProducts !== null) {
        this.logger.log('Approved products cache HIT');
        return {
          success: true,
          count: cachedProducts.length,
          products: cachedProducts,
        };
      }

      this.logger.log('Approved products cache MISS');
    } catch (error) {
      this.logger.warn(
        `Redis cache read failed; querying the database: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.APPROVED,
    };
    if (normalizedCategory) {
      where.category = {
        equals: normalizedCategory,
        mode: 'insensitive',
      };
    }

    if (normalizedQuery) {
      where.OR = [
        {
          name: {
            contains: normalizedQuery,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: normalizedQuery,
            mode: 'insensitive',
          },
        },
      ];
    }

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: approvedProductSelect,
    });

    try {
      await this.redisService.set(cacheKey, products, 300);
    } catch (error) {
      this.logger.warn(
        `Redis cache write failed; returning database results: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      success: true,
      count: products.length,
      products,
    };
  }

  // Get recommended products based on sales
  async getRecommendedProducts(limit = 8) {
    const safeLimit = Math.min(
      Math.max(Math.floor(limit) || 8, 1),
      50,
    );

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

  // Get a single approved product
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
      throw new NotFoundException('Product not found.');
    }

    return {
      success: true,
      product,
    };
  }
}