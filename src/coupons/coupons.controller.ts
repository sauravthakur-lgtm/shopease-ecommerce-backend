import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { CouponsService } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { CouponValidationResponseDto } from './dto/coupon-validation-response.dto';
import {
  CouponListResponseDto,
  CouponResponseDto,
  CouponResponseWrapperDto,
} from './dto/coupon-response.dto';

@ApiTags('Coupons')
@ApiExtraModels(CouponResponseDto)
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('access-token')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post('admin/coupons')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a coupon (administrator only)' })
  @ApiResponse({
    status: 201,
    description: 'Coupon created',
    type: CouponResponseWrapperDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid coupon configuration' })
  @ApiResponse({ status: 409, description: 'Coupon code already exists' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  create(@Body() dto: CreateCouponDto) {
    return this.couponsService.create(dto);
  }

  @Get('admin/coupons')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'List coupons (administrator only)' })
  @ApiResponse({
    status: 200,
    description: 'Coupons returned',
    type: CouponListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  findAll() {
    return this.couponsService.findAll();
  }

  @Get('admin/coupons/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Get a coupon by ID (administrator only)' })
  @ApiParam({ name: 'id', description: 'Coupon UUID' })
  @ApiResponse({
    status: 200,
    description: 'Coupon returned',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        coupon: { $ref: getSchemaPath(CouponResponseDto) },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid coupon UUID' })
  @ApiResponse({ status: 404, description: 'Coupon not found' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.couponsService.findOne(id);
  }

  @Patch('admin/coupons/:id')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update a coupon (administrator only)' })
  @ApiParam({ name: 'id', description: 'Coupon UUID' })
  @ApiResponse({
    status: 200,
    description: 'Coupon updated',
    type: CouponResponseWrapperDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid coupon configuration' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  @ApiResponse({ status: 409, description: 'Coupon code already exists' })
  @ApiResponse({ status: 404, description: 'Coupon not found' })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.couponsService.update(id, dto);
  }

  @Delete('admin/coupons/:id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Deactivate a coupon without deleting order history',
  })
  @ApiParam({ name: 'id', description: 'Coupon UUID' })
  @ApiResponse({ status: 200, description: 'Coupon deactivated' })
  @ApiResponse({ status: 400, description: 'Invalid coupon UUID' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Administrator role required' })
  @ApiResponse({ status: 404, description: 'Coupon not found' })
  deactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.couponsService.deactivate(id);
  }

  @Post('coupons/validate')
  @Roles('CUSTOMER')
  @ApiOperation({ summary: 'Validate a coupon for an order amount' })
  @ApiResponse({
    status: 200,
    description: 'Discount and final amount returned',
    type: CouponValidationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Coupon cannot be applied' })
  @ApiResponse({ status: 404, description: 'Coupon not found' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Customer role required' })
  validate(@Req() req: AuthenticatedRequest, @Body() dto: ValidateCouponDto) {
    return this.couponsService.validate(
      dto.code,
      dto.orderAmount,
      req.user.userId,
    );
  }
}
