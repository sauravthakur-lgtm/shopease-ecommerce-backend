import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';

export const MAX_NOTIFICATIONS_PAGE_SIZE = 50;

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Prisma.InputJsonObject;
  dedupeKey?: string;
}

export type AdminNotificationInput = Omit<NotificationInput, 'userId'>;

// userId and dedupeKey are internal and never returned to clients.
const notificationSelect = {
  id: true,
  type: true,
  title: true,
  message: true,
  data: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Stores notifications using the caller's client. Business flows pass their
   * transaction client so a notification exists only if the business change
   * commits; a failed insert therefore rolls the business change back too.
   * Duplicate (userId, dedupeKey) pairs are skipped with ON CONFLICT DO NOTHING,
   * which keeps the surrounding PostgreSQL transaction usable.
   */
  async create(
    client: Prisma.TransactionClient,
    notifications: NotificationInput | NotificationInput[],
  ) {
    const data = Array.isArray(notifications) ? notifications : [notifications];
    if (data.length === 0) {
      return 0;
    }

    const result = await client.notification.createMany({
      data,
      skipDuplicates: true,
    });
    return result.count;
  }

  async notifyAdmins(
    client: Prisma.TransactionClient,
    notification: AdminNotificationInput,
  ) {
    const admins = await client.user.findMany({
      where: { role: UserRole.ADMIN, isActive: true },
      select: { id: true },
    });

    return this.create(
      client,
      admins.map((admin) => ({ ...notification, userId: admin.id })),
    );
  }

  async listForUser(userId: string, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, MAX_NOTIFICATIONS_PAGE_SIZE);
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: notificationSelect,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      success: true,
      count: notifications.length,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      notifications,
    };
  }

  async getUnreadCount(userId: string) {
    const unreadCount = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });

    return {
      success: true,
      unreadCount,
    };
  }

  async markAsRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: notificationSelect,
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return {
      success: true,
      message: 'Notification marked as read',
      notification,
    };
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });

    return {
      success: true,
      message: 'All notifications marked as read',
      updated: result.count,
    };
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.notification.deleteMany({
      where: { id, userId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Notification not found');
    }

    return {
      success: true,
      message: 'Notification deleted successfully',
    };
  }
}
