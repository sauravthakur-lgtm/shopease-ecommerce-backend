import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus, Prisma, ProductStatus, UserRole } from '@prisma/client';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto/update-order-status.dto';
import { ProductsService } from '../products/products.service';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import {
  AnalyticsDateRangeDto,
  SalesPeriod,
  SalesReportQueryDto,
  TopProductsQueryDto,
} from './dto/analytics-query.dto';
import { RejectProductDto } from './dto/reject-product.dto';
import { NotificationsService } from '../notifications/notifications.service';
import {
  orderStatusChangedNotification,
  productApprovedNotification,
  productRejectedNotification,
  vendorApprovedNotification,
} from '../notifications/notification-events';

const REVENUE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

const reviewedProductSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
  stock: true,
  status: true,
  imageUrl: true,
  vendorId: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

type DateRange = {
  startDate?: Date;
  endDate?: Date;
};

type SalesPeriodRow = {
  periodStart: Date;
  totalOrders: number;
  grossSales: Prisma.Decimal | null;
  discounts: Prisma.Decimal | null;
  revenue: Prisma.Decimal | null;
};

type TopProductRow = {
  productId: string;
  productName: string;
  totalQuantitySold: number;
  totalSalesAmount: Prisma.Decimal | null;
  orderCount: number;
};

@Injectable()
export class AdminService {
  constructor(
  private readonly prisma: PrismaService,
  private readonly mailService: MailService,
  private readonly productsService: ProductsService,
  private readonly notificationsService: NotificationsService,
) {}

  async getAnalyticsSummary(query: AnalyticsDateRangeDto) {
    const range = this.parseDateRange(query);
    const dateWhere = this.buildOrderDateWhere(range);

    const [totalCustomers, totalProducts, orderCounts, revenue] =
      await Promise.all([
        this.prisma.user.count({ where: { role: UserRole.CUSTOMER } }),
        this.prisma.product.count(),
        this.prisma.order.groupBy({
          by: ['status'],
          where: dateWhere,
          _count: { _all: true },
        }),
        this.prisma.order.aggregate({
          where: {
            ...dateWhere,
            status: { in: REVENUE_ORDER_STATUSES },
          },
          _sum: { totalAmount: true, discountAmount: true },
          _avg: { totalAmount: true },
        }),
      ]);

    const statusCounts = new Map(
      orderCounts.map(({ status, _count }) => [status, _count._all]),
    );
    const netRevenue = Number(revenue._sum.totalAmount ?? 0);
    const discounts = Number(revenue._sum.discountAmount ?? 0);

    return {
      totalRevenue: netRevenue,
      grossSales: netRevenue + discounts,
      discounts,
      netRevenue,
      totalOrders: orderCounts.reduce((sum, item) => sum + item._count._all, 0),
      totalCustomers,
      totalProducts,
      totalDeliveredOrders: statusCounts.get(OrderStatus.DELIVERED) ?? 0,
      totalPendingOrders: statusCounts.get(OrderStatus.PENDING) ?? 0,
      totalCancelledOrders: statusCounts.get(OrderStatus.CANCELLED) ?? 0,
      averageOrderValue: Number(revenue._avg.totalAmount ?? 0),
    };
  }

  async getSalesReport(query: SalesReportQueryDto) {
    const range = this.parseDateRange(query);
    const period = query.period ?? SalesPeriod.DAILY;
    const rows = await this.prisma.$queryRaw<SalesPeriodRow[]>(
      Prisma.sql`
        SELECT
          date_trunc(${period}, o."createdAt") AS "periodStart",
          COUNT(*)::int AS "totalOrders",
          SUM(o."totalAmount" + o."discountAmount") AS "grossSales",
          SUM(o."discountAmount") AS "discounts",
          SUM(o."totalAmount") AS "revenue"
        FROM "Order" o
        WHERE o."status" IN (
          'CONFIRMED'::"OrderStatus",
          'SHIPPED'::"OrderStatus",
          'DELIVERED'::"OrderStatus"
        )
        ${this.buildSqlDateFilter(range)}
        GROUP BY date_trunc(${period}, o."createdAt")
        ORDER BY "periodStart" ASC
      `,
    );

    const sales = rows.map((row) => ({
      periodStart: row.periodStart.toISOString(),
      totalOrders: row.totalOrders,
      grossSales: Number(row.grossSales ?? 0),
      discounts: Number(row.discounts ?? 0),
      revenue: Number(row.revenue ?? 0),
    }));

    return {
      period,
      sales,
      totalOrders: sales.reduce((sum, row) => sum + row.totalOrders, 0),
      grossSales: sales.reduce((sum, row) => sum + row.grossSales, 0),
      discounts: sales.reduce((sum, row) => sum + row.discounts, 0),
      revenue: sales.reduce((sum, row) => sum + row.revenue, 0),
    };
  }

  async getTopProducts(query: TopProductsQueryDto) {
    const range = this.parseDateRange(query);
    const limit = query.limit ?? 10;
    const rows = await this.prisma.$queryRaw<TopProductRow[]>(
      Prisma.sql`
        SELECT
          p."id" AS "productId",
          p."name" AS "productName",
          SUM(s."quantity")::int AS "totalQuantitySold",
          SUM(s."salesAmount") AS "totalSalesAmount",
          COUNT(DISTINCT s."orderId")::int AS "orderCount"
        FROM (
          SELECT
            i."productId",
            i."quantity",
            i."quantity" * i."priceAtPurchase" AS "salesAmount",
            o."id" AS "orderId"
          FROM "OrderItem" i
          INNER JOIN "Order" o ON o."id" = i."orderId"
          WHERE o."status" IN (
            'CONFIRMED'::"OrderStatus",
            'SHIPPED'::"OrderStatus",
            'DELIVERED'::"OrderStatus"
          )
          ${this.buildSqlDateFilter(range)}

          UNION ALL

          SELECT
            o."productId",
            o."quantity",
            o."totalAmount" + o."discountAmount" AS "salesAmount",
            o."id" AS "orderId"
          FROM "Order" o
          WHERE o."status" IN (
            'CONFIRMED'::"OrderStatus",
            'SHIPPED'::"OrderStatus",
            'DELIVERED'::"OrderStatus"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "OrderItem" i WHERE i."orderId" = o."id"
          )
          ${this.buildSqlDateFilter(range)}
        ) s
        INNER JOIN "Product" p ON p."id" = s."productId"
        GROUP BY p."id", p."name"
        ORDER BY "totalSalesAmount" DESC, "totalQuantitySold" DESC, p."id" ASC
        LIMIT ${limit}
      `,
    );

    return rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      totalQuantitySold: row.totalQuantitySold,
      totalSalesAmount: Number(row.totalSalesAmount ?? 0),
      orderCount: row.orderCount,
    }));
  }

  async getOrderStatusAnalytics(query: AnalyticsDateRangeDto) {
    const range = this.parseDateRange(query);
    const groups = await this.prisma.order.groupBy({
      by: ['status'],
      where: this.buildOrderDateWhere(range),
      _count: { _all: true },
    });
    const groupedCounts = new Map(
      groups.map(({ status, _count }) => [status, _count._all]),
    );
    const totalOrders = groups.reduce(
      (sum, group) => sum + group._count._all,
      0,
    );

    return {
      totalOrders,
      statuses: Object.values(OrderStatus).map((status) => {
        const count = groupedCounts.get(status) ?? 0;
        return {
          status,
          count,
          percentage:
            totalOrders === 0
              ? 0
              : Number(((count / totalOrders) * 100).toFixed(2)),
        };
      }),
    };
  }

  private parseDateRange(query: AnalyticsDateRangeDto): DateRange {
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const endDate = query.endDate ? new Date(query.endDate) : undefined;

    if (
      (startDate && Number.isNaN(startDate.getTime())) ||
      (endDate && Number.isNaN(endDate.getTime()))
    ) {
      throw new BadRequestException('Dates must be valid ISO 8601 values');
    }

    if (endDate && query.endDate && /^\d{4}-\d{2}-\d{2}$/.test(query.endDate)) {
      endDate.setUTCHours(23, 59, 59, 999);
    }

    if (startDate && endDate && startDate > endDate) {
      throw new BadRequestException('startDate must not be later than endDate');
    }

    return { startDate, endDate };
  }

  private buildOrderDateWhere(range: DateRange): Prisma.OrderWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (range.startDate) createdAt.gte = range.startDate;
    if (range.endDate) createdAt.lte = range.endDate;
    return Object.keys(createdAt).length > 0 ? { createdAt } : {};
  }

  private buildSqlDateFilter(range: DateRange): Prisma.Sql {
    return Prisma.sql`
      ${range.startDate
        ? Prisma.sql`AND o."createdAt" >= ${range.startDate}`
        : Prisma.empty}
      ${range.endDate
        ? Prisma.sql`AND o."createdAt" <= ${range.endDate}`
        : Prisma.empty}
    `;
  }

  async getPendingVendors() {
    const vendors = await this.prisma.user.findMany({
      where: {
        role: 'VENDOR',
        isActive: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      success: true,
      count: vendors.length,
      vendors,
    };
  }

  async approveVendor(id: string) {
    const vendor = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!vendor || vendor.role !== 'VENDOR') {
      throw new NotFoundException('Vendor not found');
    }

    if (vendor.isActive) {
      throw new ForbiddenException('Vendor is already active');
    }

    const updatedVendor = await this.prisma.$transaction(async (tx) => {
      // Conditional update: repeated or concurrent approvals activate (and notify) once.
      const activation = await tx.user.updateMany({
        where: { id, role: UserRole.VENDOR, isActive: false },
        data: { isActive: true },
      });

      if (activation.count === 0) {
        throw new ForbiddenException('Vendor is already active');
      }

      const { updatedAt, ...activatedVendor } = await tx.user.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          updatedAt: true,
        },
      });

      await this.notificationsService.create(
        tx,
        vendorApprovedNotification({ id, updatedAt }),
      );

      return activatedVendor;
    });

    return {
      success: true,
      message: 'Vendor approved successfully',
      vendor: updatedVendor,
    };
  }

  async deactivateVendor(id: string) {
    const vendor = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    });

    if (!vendor || vendor.role !== UserRole.VENDOR) {
      throw new NotFoundException('Vendor not found');
    }

    if (!vendor.isActive) {
      return {
        success: true,
        message: 'Vendor is already inactive.',
      };
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id },
        data: { isActive: false },
      });
      await transaction.product.updateMany({
        where: { vendorId: id, status: ProductStatus.APPROVED },
        data: { status: ProductStatus.PENDING },
      });
    });

    return {
      success: true,
      message:
        'Vendor deactivated. Their approved products are pending admin review and order history is preserved.',
    };
  }

  async updateProduct(
    id: string,
    adminId: string,
    dto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(id, adminId, UserRole.ADMIN, dto);
  }

  async deleteProduct(id: string, adminId: string) {
    return this.productsService.deleteProduct(id, adminId, UserRole.ADMIN);
  }

  // Get all pending products
  async getPendingProducts() {
    const products = await this.prisma.product.findMany({
      where: {
        status: ProductStatus.PENDING,
      },
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      success: true,
      count: products.length,
      products,
    };
  }

  async getAllVendors() {
  const vendors = await this.prisma.user.findMany({
    where: {
      role: 'VENDOR',
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return {
    success: true,
    count: vendors.length,
    vendors,
  };
}

  async getAllProducts() {
    const products = await this.prisma.product.findMany({
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      success: true,
      count: products.length,
      products,
    };
  }

  async updateProductImage(id: string, file?: Express.Multer.File) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const imageUrl = await this.productsService.validateAndGetImageUrl(file);
    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: { imageUrl },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        status: true,
      },
    });

    return {
      success: true,
      message: 'Product image updated successfully.',
      product: updatedProduct,
    };
  }

  // Approve a product
  async approveProduct(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { vendor: { select: { isActive: true } } },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.status !== ProductStatus.PENDING) {
      throw new ForbiddenException(
        'Only pending products can be approved',
      );
    }
    if (!product.vendor.isActive) {
      throw new ForbiddenException(
        'Products from inactive vendors cannot be approved',
      );
    }

    const updatedProduct = await this.prisma.$transaction(async (tx) => {
      // Conditional update: a concurrent approval or rejection cannot be applied twice.
      const approval = await tx.product.updateMany({
        where: { id, status: ProductStatus.PENDING },
        data: {
          status: ProductStatus.APPROVED,
        },
      });

      if (approval.count === 0) {
        throw new ForbiddenException(
          'Only pending products can be approved',
        );
      }

      const approvedProduct = await tx.product.findUniqueOrThrow({
        where: { id },
        select: reviewedProductSelect,
      });

      await this.notificationsService.create(
        tx,
        productApprovedNotification(approvedProduct),
      );

      return approvedProduct;
    });

    return {
      success: true,
      message: 'Product approved successfully',
      product: updatedProduct,
    };
  }

  // Reject a product
  async rejectProduct(id: string, dto?: RejectProductDto) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.status !== ProductStatus.PENDING) {
      throw new ForbiddenException(
        'Only pending products can be rejected',
      );
    }

    const reason = dto?.reason || undefined;

    const updatedProduct = await this.prisma.$transaction(async (tx) => {
      const rejection = await tx.product.updateMany({
        where: { id, status: ProductStatus.PENDING },
        data: {
          status: ProductStatus.REJECTED,
        },
      });

      if (rejection.count === 0) {
        throw new ForbiddenException(
          'Only pending products can be rejected',
        );
      }

      const rejectedProduct = await tx.product.findUniqueOrThrow({
        where: { id },
        select: reviewedProductSelect,
      });

      await this.notificationsService.create(
        tx,
        productRejectedNotification(rejectedProduct, reason),
      );

      return rejectedProduct;
    });

    return {
      success: true,
      message: 'Product rejected successfully',
      product: updatedProduct,
    };
  }

async getAllOrders() {
  const orders = await this.prisma.order.findMany({
    include: {
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      product: {
        select: {
          id: true,
          name: true,
          price: true,
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


async updateOrderStatus(
  id: string,
  dto: UpdateOrderStatusDto,
) {
  const { order, updatedOrder } = await this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
    const currentOrder = await tx.order.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true, email: true } },
        items: { include: { product: { select: { name: true } } } },
        product: { select: { name: true } },
      },
    });

    if (!currentOrder) {
      throw new NotFoundException('Order not found');
    }

    if (
      currentOrder.status === OrderStatus.CANCELLED &&
      dto.status !== OrderStatus.CANCELLED
    ) {
      throw new BadRequestException(
        'Cancelled orders cannot be reactivated; create a new order instead',
      );
    }

    if (
      currentOrder.status !== OrderStatus.CANCELLED &&
      dto.status === OrderStatus.CANCELLED &&
      currentOrder.couponId
    ) {
      const released = await tx.coupon.updateMany({
        where: {
          id: currentOrder.couponId,
          currentUsageCount: { gt: 0 },
        },
        data: { currentUsageCount: { decrement: 1 } },
      });
      if (released.count !== 1) {
        throw new BadRequestException(
          'Coupon usage reservation could not be released',
        );
      }
    }

    const changedOrder = await tx.order.update({
      where: { id },
      data: { status: dto.status },
    });

    if (currentOrder.status !== dto.status) {
      await this.notificationsService.create(
        tx,
        orderStatusChangedNotification(
          currentOrder,
          currentOrder.status,
          dto.status,
          currentOrder.updatedAt,
        ),
      );
    }

    return { order: currentOrder, updatedOrder: changedOrder };
  });

  // Send email only when order becomes CONFIRMED
  if (
    order.status !== OrderStatus.CONFIRMED &&
    dto.status === OrderStatus.CONFIRMED
  ) {
    const products =
      order.items.length > 0
        ? order.items
            .map(
              (item) =>
                `${item.product.name} x ${item.quantity}`,
            )
            .join('\n')
        : `${order.product.name} x ${order.quantity}`;

    try {
      await this.mailService.sendEmail(
        order.customer.email,
        'Your Order Has Been Confirmed',
        `Hi ${order.customer.name},

Your order has been confirmed successfully.

Order ID: ${order.id}

Products:
${products}

Total Amount: ₹${order.totalAmount}
Status: CONFIRMED

Thank you for shopping with us!`,
      );
    } catch (error) {
      console.error(
        'Order confirmation email failed:',
        error,
      );
    }
  }

  return {
    success: true,
    message: 'Order status updated successfully',
    order: updatedOrder,
  };
}

}