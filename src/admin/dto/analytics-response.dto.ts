import { ApiProperty } from '@nestjs/swagger';
import { OrderStatus } from '@prisma/client';

export class AnalyticsSummaryDto {
  @ApiProperty() totalRevenue: number;
  @ApiProperty() grossSales: number;
  @ApiProperty() discounts: number;
  @ApiProperty() netRevenue: number;
  @ApiProperty() totalOrders: number;
  @ApiProperty() totalCustomers: number;
  @ApiProperty() totalProducts: number;
  @ApiProperty() totalDeliveredOrders: number;
  @ApiProperty() totalPendingOrders: number;
  @ApiProperty() totalCancelledOrders: number;
  @ApiProperty({
    description: 'Mean net amount per paid order in the selected date range.',
  })
  averageOrderValue: number;
}

export class SalesPeriodDto {
  @ApiProperty({ example: '2026-10-28T00:00:00.000Z' })
  periodStart: string;

  @ApiProperty() totalOrders: number;
  @ApiProperty() grossSales: number;
  @ApiProperty() discounts: number;
  @ApiProperty() revenue: number;
}

export class SalesReportDto {
  @ApiProperty({ enum: ['daily', 'weekly', 'monthly'] })
  period: string;

  @ApiProperty({ type: [SalesPeriodDto] })
  sales: SalesPeriodDto[];

  @ApiProperty() totalOrders: number;
  @ApiProperty() grossSales: number;
  @ApiProperty() discounts: number;
  @ApiProperty() revenue: number;
}

export class TopProductDto {
  @ApiProperty() productId: string;
  @ApiProperty() productName: string;
  @ApiProperty() totalQuantitySold: number;
  @ApiProperty({
    description: 'Gross item sales before order-level coupon discounts.',
  })
  totalSalesAmount: number;
  @ApiProperty() orderCount: number;
}

export class OrderStatusCountDto {
  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty() count: number;
  @ApiProperty({ description: 'Percentage of all orders in the selected range.' })
  percentage: number;
}

export class OrderStatusAnalyticsDto {
  @ApiProperty() totalOrders: number;
  @ApiProperty({ type: [OrderStatusCountDto] })
  statuses: OrderStatusCountDto[];
}
