import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Req,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { profileImageUploadOptions } from '../profiles/profile-image-upload';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ProfileService } from '../profiles/profile.service';
import { UpdateProfileDto } from '../profiles/dto/update-profile.dto';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto/update-order-status.dto';
import { productImageUploadOptions } from '../products/product-image-upload';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import { RejectProductDto } from './dto/reject-product.dto';
import {
  AnalyticsDateRangeDto,
  SalesReportQueryDto,
  TopProductsQueryDto,
} from './dto/analytics-query.dto';
import {
  AnalyticsSummaryDto,
  OrderStatusAnalyticsDto,
  SalesReportDto,
  TopProductDto,
} from './dto/analytics-response.dto';

@ApiTags('Administration')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth('access-token')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly profileService: ProfileService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get the authenticated administrator profile' })
  @ApiResponse({ status: 200, description: 'Administrator profile returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  @ApiResponse({ status: 404, description: 'Administrator profile not found' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.profileService.getProfile(req.user.userId, 'ADMIN');
  }

  @Patch('profile')
  @ApiOperation({
    summary:
      'Update the authenticated administrator name, phone, or profile image URL',
  })
  @ApiResponse({ status: 200, description: 'Administrator profile updated' })
  @ApiResponse({ status: 400, description: 'Invalid profile data' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  @ApiResponse({ status: 404, description: 'Administrator profile not found' })
  updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(req.user.userId, 'ADMIN', dto);
  }

  @Post('profile/image')
  @UseInterceptors(FileInterceptor('image', profileImageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload a profile image for the authenticated administrator' })
  @ApiResponse({ status: 201, description: 'Administrator profile image updated' })
  @ApiResponse({ status: 400, description: 'Invalid or missing image file' })
  @ApiResponse({ status: 413, description: 'Image exceeds the 5 MiB upload limit' })
  uploadProfileImage(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.profileService.uploadProfileImage(req.user.userId, 'ADMIN', file);
  }

  @Get('analytics/summary')
  @ApiOperation({
    summary: 'Get dashboard totals and paid-order revenue',
    description:
      'Order metrics accept an optional inclusive ISO 8601 date range. Customers and products are lifetime counts. totalRevenue is net of recorded coupon discounts; grossSales is net revenue plus discounts. CONFIRMED, SHIPPED, and DELIVERED are the persisted paid-order signals. The schema does not record payment failures or refunds, and manually confirmed orders are indistinguishable from captured payments.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard summary returned',
    type: AnalyticsSummaryDto,
  })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 400, description: 'Invalid date range' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getAnalyticsSummary(@Query() query: AnalyticsDateRangeDto) {
    return this.adminService.getAnalyticsSummary(query);
  }

  @Get('analytics/sales')
  @ApiOperation({
    summary: 'Get daily, weekly, or monthly paid sales',
    description:
      'Groups paid orders by UTC calendar interval. startDate and endDate are inclusive ISO 8601 timestamps; a date-only endDate includes that full UTC day. Revenue is net of recorded coupon discounts; cancelled and pending orders are excluded. The schema does not record refunds or failed payment attempts.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Sales report returned; an empty range returns zero totals and an empty sales array',
    type: SalesReportDto,
  })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['daily', 'weekly', 'monthly'],
    example: 'daily',
  })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 400, description: 'Invalid date range or period' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getSalesReport(@Query() query: SalesReportQueryDto) {
    return this.adminService.getSalesReport(query);
  }

  @Get('analytics/top-products')
  @ApiOperation({
    summary: 'Get top-selling products',
    description:
      'Ranks order items by gross item sales, quantity, and count of distinct orders. Only CONFIRMED, SHIPPED, and DELIVERED orders are included; order-level discounts are not attributed to individual items.',
  })
  @ApiResponse({
    status: 200,
    description: 'Top-selling products returned',
    type: TopProductDto,
    isArray: true,
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 400, description: 'Invalid date range or limit' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getTopProducts(@Query() query: TopProductsQueryDto) {
    return this.adminService.getTopProducts(query);
  }

  @Get('analytics/order-status')
  @ApiOperation({
    summary: 'Get order counts and percentages by status',
    description:
      'Counts all order statuses in the optional inclusive ISO 8601 date range. The current schema has no separate payment status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Order status analytics returned',
    type: OrderStatusAnalyticsDto,
  })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 400, description: 'Invalid date range' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getOrderStatusAnalytics(@Query() query: AnalyticsDateRangeDto) {
    return this.adminService.getOrderStatusAnalytics(query);
  }

  @Get('vendors/pending')
  @ApiOperation({ summary: 'List vendors awaiting approval' })
  @ApiResponse({ status: 200, description: 'Pending vendors returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getPendingVendors() {
    return this.adminService.getPendingVendors();
  }

  @Patch('vendors/:id/approve')
  @ApiOperation({ summary: 'Approve a vendor' })
  @ApiParam({ name: 'id', description: 'Vendor UUID' })
  @ApiResponse({ status: 200, description: 'Vendor approved' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  approveVendor(@Param('id') id: string) {
    return this.adminService.approveVendor(id);
  }

  @Patch('vendors/:id/deactivate')
  @ApiOperation({
    summary: 'Deactivate a vendor and unpublish its approved products',
    description:
      'Preserves the vendor account, products, and order history. Existing approved products return to pending approval.',
  })
  @ApiParam({ name: 'id', description: 'Vendor UUID' })
  @ApiResponse({ status: 200, description: 'Vendor deactivated' })
  @ApiResponse({ status: 404, description: 'Vendor not found' })
  deactivateVendor(@Param('id') id: string) {
    return this.adminService.deactivateVendor(id);
  }

  @Get('products/pending')
  @ApiOperation({ summary: 'List products awaiting approval' })
  @ApiResponse({ status: 200, description: 'Pending products returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getPendingProducts() {
    return this.adminService.getPendingProducts();
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Update product details as an administrator' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  @ApiResponse({ status: 400, description: 'Invalid product fields' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  updateProduct(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.adminService.updateProduct(id, req.user.userId, dto);
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Delete a product as an administrator' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Products with order history cannot be deleted' })
  deleteProduct(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.adminService.deleteProduct(id, req.user.userId);
  }

  @Patch('products/:id/approve')
  @ApiOperation({ summary: 'Approve a product' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product approved' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  approveProduct(@Param('id') id: string) {
    return this.adminService.approveProduct(id);
  }

  @Patch('products/:id/reject')
  @ApiOperation({
    summary: 'Reject a pending product',
    description:
      'Sets the product status to REJECTED and notifies its vendor. The optional reason is included in the vendor notification only.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product rejected' })
  @ApiResponse({ status: 400, description: 'Invalid rejection reason' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required or product is not pending' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  rejectProduct(@Param('id') id: string, @Body() dto: RejectProductDto) {
    return this.adminService.rejectProduct(id, dto);
  }

  @Get('products')
  @ApiOperation({ summary: 'List all products for administration' })
  @ApiResponse({ status: 200, description: 'Products returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getAllProducts() {
    return this.adminService.getAllProducts();
  }

  @Patch('products/:id/image')
  @UseInterceptors(FileInterceptor('image', productImageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Update a product image' })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product image updated' })
  @ApiResponse({
    status: 400,
    description: 'Unsupported image type or file too large',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  updateProductImage(
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.adminService.updateProductImage(id, file);
  }

  @Get('orders')
  @ApiOperation({ summary: 'List all orders for administration' })
  @ApiResponse({ status: 200, description: 'Orders returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getAllOrders() {
    return this.adminService.getAllOrders();
  }

  @Patch('orders/:id/status')
  @ApiOperation({ summary: 'Update an order status' })
  @ApiParam({ name: 'id', description: 'Order UUID' })
  @ApiResponse({ status: 200, description: 'Order status updated' })
  @ApiResponse({ status: 400, description: 'Invalid order status' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  updateOrderStatus(
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.adminService.updateOrderStatus(id, dto);
  }
  @Get('vendors')
@ApiOperation({ summary: 'List all vendors for administration' })
@ApiResponse({ status: 200, description: 'All vendors returned' })
@ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
@ApiResponse({ status: 403, description: 'Administrator role required' })
getAllVendors() {
  return this.adminService.getAllVendors();
}
}
