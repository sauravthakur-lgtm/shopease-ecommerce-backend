import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AnalyticsDateRangeDto, SalesReportQueryDto } from './dto/analytics-query.dto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { NotificationsService } from '../notifications/notifications.service';

function createAdminService(prisma: Partial<PrismaService>) {
  return new AdminService(
    prisma as PrismaService,
    {} as MailService,
    {} as ProductsService,
    {} as NotificationsService,
  );
}

describe('Admin analytics', () => {
  it('calculates gross sales, discounts, net revenue and paid-order average', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { status: OrderStatus.DELIVERED, _count: { _all: 2 } },
      { status: OrderStatus.CONFIRMED, _count: { _all: 1 } },
      { status: OrderStatus.PENDING, _count: { _all: 1 } },
      { status: OrderStatus.CANCELLED, _count: { _all: 1 } },
    ]);
    const aggregate = jest.fn().mockResolvedValue({
      _sum: {
        totalAmount: new Prisma.Decimal('270.00'),
        discountAmount: new Prisma.Decimal('30.00'),
      },
      _avg: { totalAmount: new Prisma.Decimal('90.00') },
    });
    const service = createAdminService({
      user: { count: jest.fn().mockResolvedValue(4) },
      product: { count: jest.fn().mockResolvedValue(8) },
      order: { groupBy, aggregate },
    });

    await expect(service.getAnalyticsSummary({})).resolves.toMatchObject({
      totalRevenue: 270,
      netRevenue: 270,
      grossSales: 300,
      discounts: 30,
      totalOrders: 5,
      totalCustomers: 4,
      totalProducts: 8,
      totalDeliveredOrders: 2,
      totalPendingOrders: 1,
      totalCancelledOrders: 1,
      averageOrderValue: 90,
    });
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['CONFIRMED', 'SHIPPED', 'DELIVERED'] } },
      }),
    );
    expect(groupBy).toHaveBeenCalled();
  });

  it('returns zero-valued results for empty order data', async () => {
    const service = createAdminService({
      user: { count: jest.fn().mockResolvedValue(0) },
      product: { count: jest.fn().mockResolvedValue(0) },
      order: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { totalAmount: null, discountAmount: null },
          _avg: { totalAmount: null },
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    });

    await expect(service.getAnalyticsSummary({})).resolves.toMatchObject({
      totalOrders: 0,
      totalRevenue: 0,
      averageOrderValue: 0,
    });
    await expect(
      service.getSalesReport({ period: 'weekly' } as SalesReportQueryDto),
    ).resolves.toMatchObject({
      sales: [],
      totalOrders: 0,
      grossSales: 0,
      discounts: 0,
      revenue: 0,
    });
    await expect(service.getTopProducts({})).resolves.toEqual([]);
    await expect(service.getOrderStatusAnalytics({})).resolves.toMatchObject({
      totalOrders: 0,
      statuses: expect.arrayContaining([
        { status: OrderStatus.PENDING, count: 0, percentage: 0 },
      ]),
    });
  });

  it('rejects reversed date ranges before querying sales', async () => {
    const queryRaw = jest.fn();
    const service = createAdminService({ $queryRaw: queryRaw as never });

    await expect(
      service.getSalesReport({
        startDate: '2026-10-28',
        endDate: '2026-10-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('includes the full UTC day for date-only end dates', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const service = createAdminService({ $queryRaw: queryRaw as never });

    await service.getSalesReport({ endDate: '2026-10-28' });

    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContainEqual(new Date('2026-10-28T23:59:59.999Z'));
  });

  it('returns grouped sales totals as JSON-safe numbers', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        periodStart: new Date('2026-10-28T00:00:00.000Z'),
        totalOrders: 2,
        grossSales: new Prisma.Decimal('120.00'),
        discounts: new Prisma.Decimal('20.00'),
        revenue: new Prisma.Decimal('100.00'),
      },
    ]);
    const service = createAdminService({ $queryRaw: queryRaw as never });

    await expect(
      service.getSalesReport({
        period: 'daily',
        startDate: '2026-10-28T00:00:00.000Z',
        endDate: '2026-10-28T23:59:59.999Z',
      }),
    ).resolves.toMatchObject({
      totalOrders: 2,
      grossSales: 120,
      discounts: 20,
      revenue: 100,
      sales: [
        {
          periodStart: '2026-10-28T00:00:00.000Z',
          totalOrders: 2,
          grossSales: 120,
          discounts: 20,
          revenue: 100,
        },
      ],
    });
  });

  it('maps top-product totals and uses the caller limit', async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        productId: 'product-1',
        productName: 'Shoes',
        totalQuantitySold: 5,
        totalSalesAmount: new Prisma.Decimal('125.50'),
        orderCount: 3,
      },
    ]);
    const service = createAdminService({ $queryRaw: queryRaw as never });

    await expect(
      service.getTopProducts({ limit: 5 }),
    ).resolves.toEqual([
      {
        productId: 'product-1',
        productName: 'Shoes',
        totalQuantitySold: 5,
        totalSalesAmount: 125.5,
        orderCount: 3,
      },
    ]);

    const query = queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContain(5);
    expect(query.strings.join('')).toContain("'DELIVERED'::\"OrderStatus\"");
    expect(query.strings.join('')).not.toContain("'CANCELLED'::\"OrderStatus\"");
  });

  it('rejects a CUSTOMER role from the existing ADMIN-guarded controller', () => {
    const reflector = new Reflector();
    const requiredRoles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      AdminController,
    ]);
    const guard = new RolesGuard(reflector);
    const handler = () => undefined;
    const context = {
      getHandler: () => handler,
      getClass: () => AdminController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { role: UserRole.CUSTOMER } as AuthenticatedUser,
        }),
      }),
    } as unknown as ExecutionContext;

    expect(requiredRoles).toEqual(['ADMIN']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('validates malformed date strings through the project DTO validation setup', async () => {
    const dto = Object.assign(new AnalyticsDateRangeDto(), {
      startDate: 'not-a-date',
    });
    const { validate } = await import('class-validator');

    await expect(validate(dto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'startDate' }),
      ]),
    );
  });
});
