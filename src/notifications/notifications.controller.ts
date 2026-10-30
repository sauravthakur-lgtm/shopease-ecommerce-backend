import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'VENDOR', 'CUSTOMER')
@ApiBearerAuth('access-token')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List notifications for the authenticated user, newest first',
  })
  @ApiResponse({ status: 200, description: 'Notification page returned' })
  @ApiResponse({ status: 400, description: 'Invalid pagination or filter' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  listNotifications(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.listForUser(req.user.userId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count unread notifications for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Unread count returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  getUnreadCount(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.getUnreadCount(req.user.userId);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications for the authenticated user as read' })
  @ApiResponse({ status: 200, description: 'Notifications marked as read' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  markAllAsRead(@Req() req: AuthenticatedRequest) {
    return this.notificationsService.markAllAsRead(req.user.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one of your notifications as read' })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  @ApiResponse({ status: 400, description: 'Invalid notification ID' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  markAsRead(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationsService.markAsRead(req.user.userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete one of your notifications' })
  @ApiParam({ name: 'id', description: 'Notification UUID' })
  @ApiResponse({ status: 200, description: 'Notification deleted' })
  @ApiResponse({ status: 400, description: 'Invalid notification ID' })
  @ApiResponse({ status: 401, description: 'Missing or invalid bearer token' })
  @ApiResponse({ status: 404, description: 'Notification not found' })
  deleteNotification(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationsService.remove(req.user.userId, id);
  }
}
