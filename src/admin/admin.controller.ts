import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto/update-order-status.dto';
import { productImageUploadOptions } from '../products/product-image-upload';

@ApiTags('Administration')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth('access-token')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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

  @Get('products/pending')
  @ApiOperation({ summary: 'List products awaiting approval' })
  @ApiResponse({ status: 200, description: 'Pending products returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  getPendingProducts() {
    return this.adminService.getPendingProducts();
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
