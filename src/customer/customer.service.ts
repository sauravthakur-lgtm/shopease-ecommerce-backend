
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';



@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(customerId: string) {
    const customer = await this.prisma.user.findUnique({
      where: {
        id: customerId,
        role: 'CUSTOMER',
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        profileImage: true,
        createdAt: true,
        updatedAt: true,
        addresses: {
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' },
          ],
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer profile not found');
    }

    return {
      success: true,
      profile: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        profileImage: customer.profileImage,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
      addresses: customer.addresses,
    };
  }


async updateProfile(
  customerId: string,
  dto: UpdateCustomerProfileDto,
) {
  const customer = await this.prisma.user.findFirst({
    where: {
      id: customerId,
      role: 'CUSTOMER',
    },
    select: { id: true },
  });

  if (!customer) {
    throw new NotFoundException('Customer profile not found');
  }

  const updatedCustomer = await this.prisma.user.update({
    where: { id: customerId },
    data: {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.profileImage !== undefined && {
        profileImage: dto.profileImage,
      }),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      profileImage: true,
      updatedAt: true,
    },
  });

  return {
    success: true,
    message: 'Customer profile updated successfully',
    profile: updatedCustomer,
  };
}

async createAddress(
  customerId: string,
  dto: CreateCustomerAddressDto,
) {
  const customer = await this.prisma.user.findFirst({
    where: {
      id: customerId,
      role: 'CUSTOMER',
    },
    select: { id: true },
  });

  if (!customer) {
    throw new NotFoundException('Customer profile not found');
  }

  const isDefault = dto.isDefault ?? false;

  const address = await this.prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.customerAddress.updateMany({
        where: { customerId },
        data: { isDefault: false },
      });
    }

    const existingAddress = await tx.customerAddress.count({
      where: { customerId },
    });

    return (tx as PrismaService).customerAddress.create({
      data: {
        customerId,
        fullName: dto.fullName,
        phone: dto.phone,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
        country: dto.country ?? 'India',
        isDefault: isDefault || existingAddress === 0,
      },
    });
  });

  return {
    success: true,
    message: 'Address added successfully',
    address,
  };
}
async updateAddress(
  customerId: string,
  addressId: string,
  dto: UpdateCustomerAddressDto,
) {
  const existingAddress = await this.prisma.customerAddress.findFirst({
    where: {
      id: addressId,
      customerId,
    },
  });

  if (!existingAddress) {
    throw new NotFoundException('Address not found');
  }

  const address = await this.prisma.customerAddress.update({
    where: {
      id: addressId,
    },
    data: {
      ...(dto.fullName !== undefined && { fullName: dto.fullName }),
      ...(dto.phone !== undefined && { phone: dto.phone }),
      ...(dto.addressLine1 !== undefined && {
        addressLine1: dto.addressLine1,
      }),
      ...(dto.addressLine2 !== undefined && {
        addressLine2: dto.addressLine2,
      }),
      ...(dto.city !== undefined && { city: dto.city }),
      ...(dto.state !== undefined && { state: dto.state }),
      ...(dto.postalCode !== undefined && {
        postalCode: dto.postalCode,
      }),
      ...(dto.country !== undefined && { country: dto.country }),
    },
  });

  return {
    success: true,
    message: 'Address updated successfully',
    address,
  };
}

async getMyOrders(customerId: string) {
  const orders = await this.prisma.order.findMany({
    where: {
      customerId,
    },
    orderBy: {
      createdAt: 'desc',
    },
    select: {
      id: true,
      quantity: true,
      totalAmount: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      product: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          price: true,
          category: true,
        },
      },
      items: {
        select: {
          id: true,
          quantity: true,
          priceAtPurchase: true,
          product: {
            select: {
              id: true,
              name: true,
              imageUrl: true,
            },
          },
        },
      },
    },
  });

  return {
    success: true,
    count: orders.length,
    orders,
  };

} 

}












