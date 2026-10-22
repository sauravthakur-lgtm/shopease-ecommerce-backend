
import {
  Controller,
  Get,
  Req,
  UseGuards,
  Patch,
  Body,
  Post,
  Param
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto';
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto';
@ApiTags('Customer')
@Controller('customer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
@ApiBearerAuth('access-token')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('profile')
  @ApiOperation({
    summary: 'Get customer profile and all saved addresses',
  })
  @ApiResponse({
    status: 200,
    description: 'Customer profile and addresses returned',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid bearer token',
  })
  @ApiResponse({
    status: 403,
    description: 'Customer role required',
  })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.customerService.getProfile(req.user.userId);
  }



@Patch('profile')
@ApiOperation({
  summary: 'Update customer profile (first name, last name, email, phone, profile image)',
})
@ApiResponse({
  status: 200,
  description: 'Customer profile updated successfully',
})
@ApiResponse({
  status: 400,
  description: 'Invalid profile data or email',
})
@ApiResponse({
  status: 401,
  description: 'Missing or invalid bearer token',
})
@ApiResponse({
  status: 403,
  description: 'Customer role required',
})
@ApiResponse({
  status: 404,
  description: 'Customer profile not found',
})
updateProfile(
  @Req() req: AuthenticatedRequest,
  @Body() dto: UpdateCustomerProfileDto,
) {
  return this.customerService.updateProfile(
    req.user.userId,
    dto,
  );
}

@Post('addresses')
@ApiOperation({ summary: 'Add a customer address' })
@ApiResponse({ status: 201, description: 'Address added successfully' })
createAddress(
  @Req() req: AuthenticatedRequest,
  @Body() dto: CreateCustomerAddressDto,
) {
  return this.customerService.createAddress(req.user.userId, dto);
}
@Patch('addresses/:id')
@ApiOperation({ summary: 'Update customer address' })
@ApiResponse({
  status: 200,
  description: 'Address updated successfully',
})
updateAddress(
  @Req() req: AuthenticatedRequest,
  @Param('id') addressId: string,
  @Body() dto: UpdateCustomerAddressDto,
) {
  return this.customerService.updateAddress(
    req.user.userId,
    addressId,
    dto,
  );
}
  @Get('orders')
  @ApiOperation({
    summary: 'Get all orders for the logged-in customer',
  })
  @ApiResponse({
    status: 200,
    description: 'Customer orders returned successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid bearer token',
  })
  @ApiResponse({
    status: 403,
    description: 'Customer role required',
  })
  getMyOrders(@Req() req: AuthenticatedRequest) {
    return this.customerService.getMyOrders(req.user.userId);
  }
}
