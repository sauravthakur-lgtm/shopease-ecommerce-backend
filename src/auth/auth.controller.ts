import { ResetPasswordDto } from './dto/reset-password.dto';
import { Body, Controller, Post, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles/roles.guard';
import { LoginDto } from './dto/login.dto';
import type { AuthenticatedRequest } from './interfaces/authenticated-request.interface';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ Post('register')
  @ApiOperation({ summary: 'Register a customer or vendor account' })
  @ApiResponse({
    status: 201,
    description: 'Account registered successfully',
    schema: {
      example: {
        success: true,
        message: 'Registration successful',
        user: {
          id: '7d9c2d72-11de-4ac4-b66b-30bfb9a7421e',
          name: 'Alex Customer',
          email: 'alex@example.com',
          role: 'CUSTOMER',
          isActive: true,
          createdAt: '2026-10-19T10:30:00.000Z',
        },
      },
    },
  })
  @ApiResponse({ status: 409, description: 'Email is already registered' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in and receive a JWT access token' })
  @ApiResponse({
    status: 201,
    description: 'Login successful; access token returned',
    schema: {
      example: {
        success: true,
        message: 'Login successful',
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        user: {
          id: '7d9c2d72-11de-4ac4-b66b-30bfb9a7421e',
          name: 'Alex Customer',
          email: 'alex@example.com',
          role: 'CUSTOMER',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials or inactive account',
  })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  @Get('profile')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the authenticated customer profile' })
  @ApiResponse({ status: 200, description: 'Authenticated profile returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 403, description: 'Customer role required' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return {
      success: true,
      user: req.user,
    };
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({
    status: 201,
    description: 'Reset instructions response returned',
  })
  @ApiResponse({ status: 400, description: 'Invalid email address' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset a password using the emailed token' })
  @ApiResponse({ status: 201, description: 'Password reset successfully' })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token, or invalid body',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}
