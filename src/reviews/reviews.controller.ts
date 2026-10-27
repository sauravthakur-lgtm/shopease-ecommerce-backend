import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Req,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@ApiTags('Reviews')
@Controller('reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  // Customer: Create a review
  @Post(':productId')
  @Roles('CUSTOMER')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Submit a product review and rating' })
  @ApiParam({ name: 'productId', description: 'Product UUID' })
  @ApiResponse({ status: 201, description: 'Review submitted successfully' })
  @ApiResponse({ status: 409, description: 'Product already reviewed' })
  createReview(
    @Req() req: AuthenticatedRequest,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.createReview(req.user.userId, productId, dto);
  }

  // Public: Get reviews for a product
  @Public()
  @Get('product/:productId')
  @ApiOperation({ summary: 'Get product reviews and average rating' })
  @ApiParam({ name: 'productId', description: 'Product UUID' })
  @ApiResponse({ status: 200, description: 'Product reviews returned' })
  getProductReviews(
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.reviewsService.getProductReviews(productId);
  }

  // Customer: Update own review
  @Patch(':reviewId')
  @Roles('CUSTOMER')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update your own product review' })
  @ApiParam({ name: 'reviewId', description: 'Review UUID' })
  updateReview(
    @Req() req: AuthenticatedRequest,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviewsService.updateReview(req.user.userId, reviewId, dto);
  }

  // Customer: Delete own review
  @Delete(':reviewId')
  @Roles('CUSTOMER')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete your own product review' })
  @ApiParam({ name: 'reviewId', description: 'Review UUID' })
  deleteReview(
    @Req() req: AuthenticatedRequest,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
  ) {
    return this.reviewsService.deleteReview(req.user.userId, reviewId);
  }
}