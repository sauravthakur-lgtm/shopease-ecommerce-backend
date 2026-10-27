import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductStatus, Prisma } from '@prisma/client';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  // Create a product review
  async createReview(customerId: string, productId: string, dto: CreateReviewDto) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: ProductStatus.APPROVED,
      },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Approved product not found');
    }

    const existingReview = await this.prisma.review.findUnique({
      where: {
        customerId_productId: {
          customerId,
          productId,
        },
      },
    });

    if (existingReview) {
      throw new ConflictException('You have already reviewed this product');
    }

    try {
      const review = await this.prisma.review.create({
        data: {
          customerId,
          productId,
          rating: dto.rating,
          comment: dto.comment?.trim() || null,
        },
      });

      return {
        success: true,
        message: 'Review submitted successfully',
        review,
      };
    } catch (error) {
      // Handles concurrent duplicate submissions
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You have already reviewed this product');
      }

      throw error;
    }
  }

  // Get reviews for a product
  async getProductReviews(productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        status: ProductStatus.APPROVED,
      },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Approved product not found');
    }

    const reviews = await this.prisma.review.findMany({
      where: { productId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ratingSummary = await this.prisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return {
      success: true,
      count: reviews.length,
      averageRating: ratingSummary._avg.rating ?? 0,
      totalReviews: ratingSummary._count.rating,
      reviews,
    };
  }

  // Update own review
  async updateReview(
    customerId: string,
    reviewId: string,
    dto: UpdateReviewDto,
  ) {
    if (dto.rating === undefined && dto.comment === undefined) {
      throw new BadRequestException('Provide a rating or comment to update');
    }

    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.customerId !== customerId) {
      throw new ForbiddenException('You can only update your own review');
    }

    const updatedReview = await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(dto.rating !== undefined && { rating: dto.rating }),
        ...(dto.comment !== undefined && {
          comment: dto.comment.trim() || null,
        }),
      },
    });

    return {
      success: true,
      message: 'Review updated successfully',
      review: updatedReview,
    };
  }

  // Delete own review
  async deleteReview(customerId: string, reviewId: string) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.customerId !== customerId) {
      throw new ForbiddenException('You can only delete your own review');
    }

    await this.prisma.review.delete({
      where: { id: reviewId },
    });

    return {
      success: true,
      message: 'Review deleted successfully',
    };
  }
}