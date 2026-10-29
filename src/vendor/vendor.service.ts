import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesPeriod } from '../admin/dto/analytics-query.dto';
import { VendorDashboardQueryDto } from './dto/vendor-dashboard-query.dto';

export const LOW_STOCK_THRESHOLD = 5;

const SALES_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

type SalesRow = {
  periodStart: Date;
  totalOrders: number;
  grossSales: Prisma.Decimal | null;
};

type TopProductRow = {
  productId: string;
  productName: string;
  imageUrl: string | null;
  status: ProductStatus;
  totalQuantitySold: number;
  grossSales: Prisma.Decimal | null;
  orderCount: number;
};

const vendorOrderFilter = (vendorId: string): Prisma.OrderWhereInput => ({
  OR: [
    { items: { some: { product: { vendorId } } } },
    { items: { none: {} }, product: { vendorId } },
  ],
});

@Injectable()
export class VendorService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(vendorId: string, query: VendorDashboardQueryDto) {
    const period = query.period ?? SalesPeriod.DAILY;
    const orderFilter = vendorOrderFilter(vendorId);
    const [productGroups, lowStockCount, orderGroups, salesRows, bestSellers] =
      await Promise.all([
        this.prisma.product.groupBy({
          by: ['status'],
          where: { vendorId },
          _count: { _all: true },
        }),
        this.prisma.product.count({
          where: { vendorId, stock: { lte: LOW_STOCK_THRESHOLD } },
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          where: orderFilter,
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<SalesRow[]>(
          this.salesSql(vendorId, period, query.startDate, query.endDate),
        ),
        this.prisma.$queryRaw<TopProductRow[]>(
          this.topProductsSql(vendorId, query.startDate, query.endDate),
        ),
      ]);

    const productCounts = new Map(
      productGroups.map(({ status, _count }) => [status, _count._all]),
    );
    const orderCounts = new Map(
      orderGroups.map(({ status, _count }) => [status, _count._all]),
    );
    const sales = salesRows.map((row) => ({
      periodStart: row.periodStart.toISOString(),
      totalOrders: Number(row.totalOrders),
      grossSales: Number(row.grossSales ?? 0),
    }));
    const totalOrders = orderGroups.reduce(
      (total, group) => total + group._count._all,
      0,
    );

    return {
      products: {
        total: productGroups.reduce(
          (total, group) => total + group._count._all,
          0,
        ),
        approved: productCounts.get(ProductStatus.APPROVED) ?? 0,
        pending: productCounts.get(ProductStatus.PENDING) ?? 0,
        rejected: productCounts.get(ProductStatus.REJECTED) ?? 0,
        lowStock: lowStockCount,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
      },
      orders: {
        total: totalOrders,
        statuses: Object.values(OrderStatus).map((status) => ({
          status,
          count: orderCounts.get(status) ?? 0,
        })),
      },
      sales: {
        period,
        history: sales,
        grossSales: sales.reduce((total, row) => total + row.grossSales, 0),
        orderCount: sales.reduce((total, row) => total + row.totalOrders, 0),
        includedStatuses: SALES_STATUSES,
        basis: 'Gross product line sales before order-level coupon discounts',
      },
      bestSellingProducts: bestSellers.map((product) => ({
        productId: product.productId,
        productName: product.productName,
        imageUrl: product.imageUrl,
        status: product.status,
        quantitySold: Number(product.totalQuantitySold),
        grossSales: Number(product.grossSales ?? 0),
        orderCount: Number(product.orderCount),
      })),
    };
  }

  async getVendorOrders(vendorId: string, page: number, limit: number) {
    const where = vendorOrderFilter(vendorId);
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          createdAt: true,
          status: true,
          items: {
            where: { product: { vendorId } },
            select: {
              id: true,
              quantity: true,
              priceAtPurchase: true,
              product: {
                select: { id: true, name: true, imageUrl: true },
              },
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
              vendorId: true,
            },
          },
          quantity: true,
          totalAmount: true,
          discountAmount: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      orders: orders.map((order) => {
        const items = order.items.length
          ? order.items
          : order.product.vendorId === vendorId
            ? [
                {
                  id: `${order.id}:${order.product.id}`,
                  quantity: order.quantity,
                  priceAtPurchase: order.quantity
                    ? order.totalAmount
                        .add(order.discountAmount)
                        .div(order.quantity)
                    : new Prisma.Decimal(0),
                  product: {
                    id: order.product.id,
                    name: order.product.name,
                    imageUrl: order.product.imageUrl,
                  },
                },
              ]
            : [];
        return {
          id: order.id,
          createdAt: order.createdAt,
          status: order.status,
          items: items.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            product: item.product,
            grossSales: Number(item.priceAtPurchase.mul(item.quantity)),
          })),
        };
      }),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateStock(vendorId: string, productId: string, stock: number) {
    const result = await this.prisma.product.updateMany({
      where: { id: productId, vendorId },
      data: { stock },
    });
    if (result.count === 0) {
      throw new NotFoundException('Product not found');
    }

    return {
      success: true,
      product: await this.prisma.product.findFirst({
        where: { id: productId, vendorId },
        select: {
          id: true,
          name: true,
          imageUrl: true,
          price: true,
          stock: true,
          status: true,
        },
      }),
    };
  }

  private salesSql(
    vendorId: string,
    period: SalesPeriod,
    startDate?: string,
    endDate?: string,
  ) {
    const dateTruncUnit =
      period === SalesPeriod.WEEKLY
        ? 'week'
        : period === SalesPeriod.MONTHLY
          ? 'month'
          : 'day';

    return Prisma.sql`
      WITH vendor_lines AS (
        SELECT oi."orderId", oi."quantity", oi."priceAtPurchase", o."createdAt"
        FROM "OrderItem" oi
        INNER JOIN "Product" p ON p."id" = oi."productId"
        INNER JOIN "Order" o ON o."id" = oi."orderId"
        WHERE p."vendorId" = ${vendorId}
          AND o."status" IN ('CONFIRMED'::"OrderStatus", 'SHIPPED'::"OrderStatus", 'DELIVERED'::"OrderStatus")
          ${this.sqlDateFilter(startDate, endDate)}

        UNION ALL

        SELECT o."id", o."quantity",
          (o."totalAmount" + o."discountAmount") / NULLIF(o."quantity", 0),
          o."createdAt"
        FROM "Order" o
        INNER JOIN "Product" p ON p."id" = o."productId"
        WHERE p."vendorId" = ${vendorId}
          AND o."status" IN ('CONFIRMED'::"OrderStatus", 'SHIPPED'::"OrderStatus", 'DELIVERED'::"OrderStatus")
          AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o."id")
          ${this.sqlDateFilter(startDate, endDate)}
      )
      SELECT date_trunc(${dateTruncUnit}, "createdAt") AS "periodStart",
        COUNT(DISTINCT "orderId")::int AS "totalOrders",
        SUM("quantity" * "priceAtPurchase") AS "grossSales"
      FROM vendor_lines
      GROUP BY 1
      ORDER BY "periodStart" ASC
    `;
  }

  private topProductsSql(
    vendorId: string,
    startDate?: string,
    endDate?: string,
  ) {
    return Prisma.sql`
      WITH vendor_lines AS (
        SELECT oi."orderId", oi."productId", oi."quantity", oi."priceAtPurchase"
        FROM "OrderItem" oi
        INNER JOIN "Product" p ON p."id" = oi."productId"
        INNER JOIN "Order" o ON o."id" = oi."orderId"
        WHERE p."vendorId" = ${vendorId}
          AND o."status" IN ('CONFIRMED'::"OrderStatus", 'SHIPPED'::"OrderStatus", 'DELIVERED'::"OrderStatus")
          ${this.sqlDateFilter(startDate, endDate)}

        UNION ALL

        SELECT o."id", o."productId", o."quantity",
          (o."totalAmount" + o."discountAmount") / NULLIF(o."quantity", 0)
        FROM "Order" o
        INNER JOIN "Product" p ON p."id" = o."productId"
        WHERE p."vendorId" = ${vendorId}
          AND o."status" IN ('CONFIRMED'::"OrderStatus", 'SHIPPED'::"OrderStatus", 'DELIVERED'::"OrderStatus")
          AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o."id")
          ${this.sqlDateFilter(startDate, endDate)}
      )
      SELECT p."id" AS "productId", p."name" AS "productName",
        p."imageUrl", p."status",
        SUM(vl."quantity")::int AS "totalQuantitySold",
        SUM(vl."quantity" * vl."priceAtPurchase") AS "grossSales",
        COUNT(DISTINCT vl."orderId")::int AS "orderCount"
      FROM vendor_lines vl
      INNER JOIN "Product" p ON p."id" = vl."productId"
      GROUP BY p."id", p."name", p."imageUrl", p."status"
      ORDER BY "totalQuantitySold" DESC, "grossSales" DESC, p."id" ASC
      LIMIT 10
    `;
  }

  private sqlDateFilter(startDate?: string, endDate?: string) {
    return Prisma.sql`
      ${startDate ? Prisma.sql`AND o."createdAt" >= ${new Date(startDate)}` : Prisma.empty}
      ${
        endDate
          ? Prisma.sql`AND o."createdAt" <= ${this.inclusiveEndDate(endDate)}`
          : Prisma.empty
      }
    `;
  }

  private inclusiveEndDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }
    return new Date(value);
  }
}
