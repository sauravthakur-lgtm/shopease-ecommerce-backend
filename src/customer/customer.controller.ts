
import {
  Controller,
  Get,
  Req,
  UseGuards,
  Patch,
  Body,
  Post,
  Param,
  Delete,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import { ProfileService } from '../profiles/profile.service';
import { profileImageUploadOptions } from '../profiles/profile-image-upload';
@ApiTags('Customer')
@Controller('customer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CUSTOMER')
@ApiBearerAuth('access-token')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly profileService: ProfileService,
  ) {}

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
@ApiOperation({ summary: 'Upload a profile image for the authenticated customer' })
@ApiResponse({ status: 201, description: 'Customer profile image updated' })
@ApiResponse({ status: 400, description: 'Invalid or missing image file' })
@ApiResponse({ status: 413, description: 'Image exceeds the 5 MiB upload limit' })
uploadProfileImage(
  @Req() req: AuthenticatedRequest,
  @UploadedFile() file?: Express.Multer.File,
) {
  return this.profileService.uploadProfileImage(
    req.user.userId,
    'CUSTOMER',
    file,
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

@Delete('addresses/:id')
@ApiOperation({ summary: 'Delete one of the authenticated customer addresses' })
@ApiResponse({ status: 200, description: 'Address deleted successfully' })
@ApiResponse({ status: 404, description: 'Address not found' })
@ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
@ApiResponse({ status: 403, description: 'Customer role required' })
deleteAddress(
  @Req() req: AuthenticatedRequest,
  @Param('id') addressId: string,
) {
  return this.customerService.deleteAddress(req.user.userId, addressId);
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
