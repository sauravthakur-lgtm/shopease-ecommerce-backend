import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { Prisma, ProductStatus, UserRole } from '@prisma/client';
import { readFile, unlink } from 'node:fs/promises';
import { basename } from 'node:path';
import { RedisService } from '../redis/redis.service';
import {
  getProductCategoryAliases,
  normalizeProductCategory,
} from './product-category';
import {
  validateProductCsv,
} from './bulk-product-upload';
import { UpdateProductDto } from './dto/update-product.dto';

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
        category: normalizeProductCategory(dto.category),
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

  async updateProduct(
    productId: string,
    userId: string,
    role: UserRole,
    dto: UpdateProductDto,
  ) {
    if (!Object.values(dto).some((value) => value !== undefined)) {
      throw new BadRequestException('At least one product field must be provided.');
    }

    const where: Prisma.ProductWhereUniqueInput = { id: productId };
    const product = await this.prisma.product.findUnique({
      where,
      select: { id: true, vendorId: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    if (role === UserRole.VENDOR && product.vendorId !== userId) {
      throw new NotFoundException('Product not found.');
    }

    const updatedProduct = await this.prisma.product.update({
      where,
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.category !== undefined
          ? { category: normalizeProductCategory(dto.category) }
          : {}),
        ...(dto.price !== undefined
          ? { price: new Prisma.Decimal(dto.price) }
          : {}),
        ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
        ...(dto.imageUrl !== undefined
          ? { imageUrl: dto.imageUrl || null }
          : {}),
        ...(role === UserRole.VENDOR ? { status: ProductStatus.PENDING } : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        imageUrl: true,
        category: true,
        price: true,
        stock: true,
        status: true,
        vendorId: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      message:
        role === UserRole.VENDOR
          ? 'Product updated and submitted for admin approval.'
          : 'Product updated successfully.',
      product: updatedProduct,
    };
  }

  async deleteProduct(productId: string, userId: string, role: UserRole) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, vendorId: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
    if (role === UserRole.VENDOR && product.vendorId !== userId) {
      throw new NotFoundException('Product not found.');
    }

    const [legacyOrders, itemOrders] = await Promise.all([
      this.prisma.order.count({ where: { productId } }),
      this.prisma.orderItem.count({ where: { productId } }),
    ]);
    if (legacyOrders > 0 || itemOrders > 0) {
      throw new ConflictException(
        'This product has order history and cannot be deleted.',
      );
    }

    try {
      await this.prisma.product.delete({ where: { id: productId } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'This product has order history and cannot be deleted.',
        );
      }
      throw error;
    }

    return {
      success: true,
      message: 'Product deleted successfully.',
      productId,
    };
  }

  async bulkUploadProducts(
    vendorId: string,
    file?: Express.Multer.File,
    validateOnly = false,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('A CSV file is required.');
    }

    const candidates = validateProductCsv(file.buffer);
    const validCandidates = candidates.filter((candidate) => candidate.dto);
    const names = [...new Set(validCandidates.map((candidate) => candidate.dto!.name))];
    const existingProducts = names.length
      ? await this.prisma.product.findMany({
          where: {
            vendorId,
            name: { in: names, mode: 'insensitive' },
          },
          select: { name: true, category: true },
        })
      : [];
    const knownProducts = new Set(
      existingProducts.map((product) =>
        this.getBulkDuplicateKey(product.name, product.category ?? ''),
      ),
    );

    for (const candidate of candidates) {
      if (!candidate.dto) continue;

      const duplicateKey = this.getBulkDuplicateKey(
        candidate.dto.name,
        candidate.dto.category,
      );
      if (knownProducts.has(duplicateKey)) {
        candidate.dto = undefined;
        candidate.errors.push({
          row: candidate.row,
          field: 'name',
          message: 'A product with this name and category already exists for your account.',
        });
      } else {
        knownProducts.add(duplicateKey);
      }
    }

    const errors = candidates.flatMap((candidate) => candidate.errors);
    const rowPreviews = candidates.map((candidate) => ({
      row: candidate.row,
      name: candidate.values.name ?? '',
      description: candidate.values.description ?? '',
      category: candidate.values.category ?? '',
      price: candidate.values.price ?? '',
      stock: candidate.values.stock ?? '',
      valid: candidate.errors.length === 0,
      errors: candidate.errors,
    }));

    if (validateOnly) {
      return {
        success: true,
        message: 'CSV validation completed.',
        totalRows: candidates.length,
        validRows: candidates.length - new Set(errors.map((error) => error.row)).size,
        failedRows: new Set(errors.map((error) => error.row)).size,
        rows: rowPreviews,
        errors,
      };
    }

    let successful = 0;
    const successfulRows: number[] = [];

    for (const candidate of candidates) {
      if (!candidate.dto) continue;

      try {
        await this.createProduct(vendorId, candidate.dto);
        successful += 1;
        successfulRows.push(candidate.row);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Bulk product import failed for vendor ${vendorId}, CSV row ${candidate.row}: ${detail}`,
        );
        candidate.errors.push({
          row: candidate.row,
          field: 'product',
          message: 'The product could not be saved because of a server error.',
        });
      }
    }

    const finalErrors = candidates.flatMap((candidate) => candidate.errors);
    const failedRows = new Set(finalErrors.map((error) => error.row)).size;

    return {
      success: failedRows === 0,
      message: 'Bulk import completed.',
      totalRows: candidates.length,
      successful,
      failed: failedRows,
      successfulRows,
      errors: finalErrors,
    };
  }

  private getBulkDuplicateKey(name: string, category: string) {
    return `${name.trim().toLocaleLowerCase('en')}\u0000${normalizeProductCategory(category).toLocaleLowerCase('en')}`;
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

    const names = [
      ...new Set(
        categories.flatMap((product) =>
          product.category === null
            ? []
            : [normalizeProductCategory(product.category)],
        ),
      ),
    ].sort((a, b) => a.localeCompare(b, 'en'));

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
        in: getProductCategoryAliases(normalizedCategory),
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
        OR: getProductCategoryAliases(normalizedCategory).map((alias) => ({
          category: { equals: alias, mode: 'insensitive' as const },
        })),
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
        in: getProductCategoryAliases(normalizedCategory),
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