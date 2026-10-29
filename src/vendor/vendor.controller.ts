import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Query,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { UpdateProfileDto } from '../profiles/dto/update-profile.dto';
import { ProfileService } from '../profiles/profile.service';
import { profileImageUploadOptions } from '../profiles/profile-image-upload';
import { VendorService } from './vendor.service';
import {
  VendorDashboardQueryDto,
  VendorOrdersQueryDto,
} from './dto/vendor-dashboard-query.dto';
import { UpdateVendorStockDto } from './dto/update-vendor-stock.dto';
import { ProductsService } from '../products/products.service';
import { bulkProductUploadOptions } from '../products/bulk-product-upload-options';
import { UpdateProductDto } from '../products/dto/update-product.dto';

@ApiTags('Vendor')
@Controller('vendor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('VENDOR')
@ApiBearerAuth('access-token')
export class VendorController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly vendorService: VendorService,
    private readonly productsService: ProductsService,
  ) {}

  @Get('products/bulk-upload/template')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="shopease-products-template.csv"',
  )
  @ApiOperation({ summary: 'Download the vendor product CSV template' })
  @ApiResponse({ status: 200, description: 'CSV template returned' })
  downloadProductCsvTemplate() {
    return 'name,description,category,price,stock,imageUrl\r\n"Everyday Tote","A roomy tote bag, made for daily errands","Clothes",29.99,25,\r\n';
  }

  @Post('products/bulk-upload')
  @UseInterceptors(FileInterceptor('file', bulkProductUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiQuery({
    name: 'validateOnly',
    required: false,
    type: Boolean,
    description: 'Validate and preview rows without creating products',
  })
  @ApiOperation({
    summary: 'Validate or import products from a CSV file',
  })
  @ApiResponse({
    status: 201,
    description: 'Validation preview or import summary returned',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid CSV, unsupported file, or invalid product rows',
  })
  @ApiResponse({
    status: 413,
    description: 'CSV file exceeds the 2 MiB upload limit',
  })
  bulkUploadProducts(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('validateOnly') validateOnly?: string,
  ) {
    if (validateOnly !== undefined && !['true', 'false'].includes(validateOnly)) {
      throw new BadRequestException('validateOnly must be true or false.');
    }

    return this.productsService.bulkUploadProducts(
      req.user.userId,
      file,
      validateOnly === 'true',
    );
  }

  @Patch('products/:id')
  @ApiOperation({
    summary: "Update details for the authenticated vendor's product",
    description:
      'Vendor edits resubmit the product for admin approval. Product status cannot be supplied by the vendor.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product updated and set to pending approval' })
  @ApiResponse({ status: 400, description: 'Invalid product fields' })
  @ApiResponse({ status: 404, description: 'Owned product not found' })
  updateProduct(
    @Req() req: AuthenticatedRequest,
    @Param('id') productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(
      productId,
      req.user.userId,
      'VENDOR',
      dto,
    );
  }

  @Delete('products/:id')
  @ApiOperation({ summary: "Delete a product owned by the authenticated vendor" })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  @ApiResponse({ status: 404, description: 'Owned product not found' })
  @ApiResponse({ status: 409, description: 'Products with order history cannot be deleted' })
  deleteProduct(
    @Req() req: AuthenticatedRequest,
    @Param('id') productId: string,
  ) {
    return this.productsService.deleteProduct(
      productId,
      req.user.userId,
      'VENDOR',
    );
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'Get dashboard statistics and sales for the authenticated vendor',
  })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['daily', 'weekly', 'monthly'],
  })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Vendor dashboard returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Vendor role required' })
  getDashboard(
    @Req() req: AuthenticatedRequest,
    @Query() query: VendorDashboardQueryDto,
  ) {
    return this.vendorService.getDashboard(req.user.userId, query);
  }

  @Get('orders')
  @ApiOperation({
    summary: 'List paginated orders containing products owned by this vendor',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiResponse({ status: 200, description: 'Vendor order page returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Vendor role required' })
  getVendorOrders(
    @Req() req: AuthenticatedRequest,
    @Query() query: VendorOrdersQueryDto,
  ) {
    return this.vendorService.getVendorOrders(
      req.user.userId,
      query.page,
      query.limit,
    );
  }

  @Patch('products/:id/stock')
  @ApiOperation({ summary: "Update stock for the authenticated vendor's product" })
  @ApiParam({ name: 'id', description: 'Product ID' })
  @ApiResponse({ status: 200, description: 'Product stock updated' })
  @ApiResponse({ status: 400, description: 'Invalid stock value' })
  @ApiResponse({ status: 404, description: 'Owned product not found' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Vendor role required' })
  updateStock(
    @Req() req: AuthenticatedRequest,
    @Param('id') productId: string,
    @Body() dto: UpdateVendorStockDto,
  ) {
    return this.vendorService.updateStock(req.user.userId, productId, dto.stock);
  }

  @Get('profile')
  @ApiOperation({ summary: 'Get the authenticated vendor profile' })
  @ApiResponse({ status: 200, description: 'Vendor profile returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Vendor role required' })
  @ApiResponse({ status: 404, description: 'Vendor profile not found' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.profileService.getProfile(req.user.userId, 'VENDOR');
  }

  @Patch('profile')
  @ApiOperation({
    summary: 'Update the authenticated vendor name, phone, or profile image URL',
  })
  @ApiResponse({ status: 200, description: 'Vendor profile updated' })
  @ApiResponse({ status: 400, description: 'Invalid profile data' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Vendor role required' })
  @ApiResponse({ status: 404, description: 'Vendor profile not found' })
  updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(req.user.userId, 'VENDOR', dto);
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
  @ApiOperation({ summary: 'Upload a profile image for the authenticated vendor' })
  @ApiResponse({ status: 201, description: 'Vendor profile image updated' })
  @ApiResponse({ status: 400, description: 'Invalid or missing image file' })
  @ApiResponse({ status: 413, description: 'Image exceeds the 5 MiB upload limit' })
  uploadProfileImage(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.profileService.uploadProfileImage(req.user.userId, 'VENDOR', file);
  }
}
