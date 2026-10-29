
import {
  Body,
  Controller,
  Delete,
  Post,
  Patch,
  Get,
  Req,
  Query,
  Param,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { productImageUploadOptions } from './product-image-upload';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { UserRole } from '@prisma/client';
import { UpdateProductDto } from './dto/update-product.dto';

@ApiTags('Products')
@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  // Vendor-only: Create product
  @Post()
  @Roles('VENDOR')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a product as a vendor' })
  @ApiResponse({
    status: 201,
    description: 'Product created and submitted for approval',
  })
  @ApiResponse({ status: 400, description: 'Invalid product details' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Vendor role required' })
  createProduct(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.createProduct(req.user.userId, dto);
  }

  @Patch(':id')
  @Roles('VENDOR')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: "Update a product owned by the authenticated vendor",
    description:
      'Vendor edits resubmit the product for admin approval. Product status cannot be supplied by the vendor.',
  })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product updated and set to pending approval' })
  @ApiResponse({ status: 400, description: 'Invalid product fields' })
  @ApiResponse({ status: 404, description: 'Owned product not found' })
  updateMyProduct(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(
      id,
      req.user.userId,
      UserRole.VENDOR,
      dto,
    );
  }

  @Delete(':id')
  @Roles('VENDOR')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "Delete a product owned by the authenticated vendor" })
  @ApiParam({ name: 'id', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  @ApiResponse({ status: 404, description: 'Owned product not found' })
  @ApiResponse({ status: 409, description: 'Products with order history cannot be deleted' })
  deleteMyProduct(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.productsService.deleteProduct(
      id,
      req.user.userId,
      UserRole.VENDOR,
    );
  }

  // Public: Upload product image
  @Public()
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('image', productImageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiOperation({ summary: 'Upload a product image without authentication' })
  @ApiResponse({ status: 201, description: 'Uploaded image URL returned' })
  @ApiResponse({
    status: 400, 
    description: 'Unsupported image type or file too large',
  })
  uploadProductImage(@UploadedFile() file?: Express.Multer.File) {
    return this.productsService.uploadProductImage(file);
  }

  // Vendor-only: List own products
  @Get('vendor-products')
  @Roles('VENDOR')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'List products belonging to the authenticated vendor',
  })
  @ApiResponse({ status: 200, description: 'Vendor product list returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Vendor role required' })
  getMyProducts(@Req() req: AuthenticatedRequest) {
    return this.productsService.getMyProducts(req.user.userId);
  }

  // Public: Product categories
  @Public()
  @Get('categories')
  @ApiOperation({ summary: 'List categories with approved products' })
  @ApiResponse({ status: 200, description: 'Available categories returned' })
  getProductCategories() {
    return this.productsService.getProductCategories();
  }

  // Public: Products by category
  @Public()
  @Get('category/:category')
  @ApiOperation({ summary: 'List approved products in a category' })
  @ApiParam({ name: 'category', description: 'Product category to filter by' })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Optional name or description keyword',
  })
  @ApiResponse({ status: 200, description: 'Category products returned' })
  @ApiResponse({ status: 400, description: 'A category is required' })
  getProductsByCategory(
    @Param('category') category: string,
    @Query('q') query?: string,
  ) {
    return this.productsService.getProductsByCategory(category, query);
  }

  // Public: Search products
  @Public()
  @Get('search')
  @ApiOperation({
    summary:
      'Search approved products by name or description and optional category',
  })
  @ApiResponse({ status: 200, description: 'Search results returned' })
  @ApiQuery({
    name: 'q',
    required: true,
    description: 'Search products by name or description',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Optional category filter',
  })
  searchProducts(
    @Query('q') query: string,
    @Query('category') category?: string,
  ) {
    return this.productsService.searchProducts(query || '', category);
  }

    // Public: Recommended best-selling products
  @Public()
  @Get('recommended')
  @ApiOperation({
    summary: 'Get recommended products based on delivered sales',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of products to return (default 8, maximum 50)',
  })
  @ApiResponse({
    status: 200,
    description: 'Recommended products returned successfully',
  })
  getRecommendedProducts(@Query('limit') limit?: string) {
    const parsedLimit = limit === undefined ? 8 : Number(limit);

    return this.productsService.getRecommendedProducts(
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.floor(parsedLimit)
        : 8,
    );
  }

  // Public: All approved products
  @Public()
  @Get()
  @ApiOperation({
    summary:
      'List approved products with optional category and keyword filters',
  })
  @ApiResponse({ status: 200, description: 'Approved product list returned' })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Filter by category',
  })
  @ApiQuery({
    name: 'q',
    required: false,
    description: 'Filter by name or description keyword',
  })
  getApprovedProducts(
    @Query('category') category?: string,
    @Query('q') query?: string,
  ) {
    return this.productsService.getApprovedProducts(category, query);
  }

    // Public: Get a single approved product by ID
  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a single approved product by ID' })
  @ApiParam({
    name: 'id',
    description: 'Product UUID',
  })
  @ApiResponse({
    status: 200,
    description: 'Product details returned successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Product not found or not approved',
  })
  getProductById(@Param('id') id: string) {
    return this.productsService.getProductById(id);
  }
}
