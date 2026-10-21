import {
  Injectable,
  
  ForbiddenException,
} from '@nestjs/common';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto/update-order-status.dto';
import { ProductsService } from '../products/products.service';
@Injectable()
export class AdminService {
  constructor(
  private readonly prisma: PrismaService,
  private readonly mailService: MailService,
  private readonly productsService: ProductsService,
) {}

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

    const updatedVendor = await this.prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
      },
    });

    return {
      success: true,
      message: 'Vendor approved successfully',
      vendor: updatedVendor,
    };
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
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (product.status !== ProductStatus.PENDING) {
      throw new ForbiddenException(
        'Only pending products can be approved',
      );
    }

    const updatedProduct = await this.prisma.product.update({
      where: { id },
      data: {
        status: ProductStatus.APPROVED,
      },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        stock: true,
        status: true,
        imageUrl: true,
        vendorId: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      message: 'Product approved successfully',
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
  const order = await this.prisma.order.findUnique({
    where: { id },
    include: {
      customer: {
        select: {
          name: true,
          email: true,
        },
      },
      items: {
        include: {
          product: {
            select: {
              name: true,
            },
          },
        },
      },
      product: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  const updatedOrder = await this.prisma.order.update({
    where: { id },
    data: { status: dto.status },
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