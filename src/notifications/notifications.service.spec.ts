import { NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAX_NOTIFICATIONS_PAGE_SIZE,
  NotificationInput,
  NotificationsService,
} from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { createInMemoryNotificationsPrisma } from '../../test/support/in-memory-notifications';

const query = (overrides: Partial<ListNotificationsQueryDto> = {}) =>
  Object.assign(new ListNotificationsQueryDto(), overrides);

const notificationFor = (
  userId: string,
  index: number,
  dedupeKey?: string,
): NotificationInput => ({
  userId,
  type: NotificationType.ORDER_PLACED,
  title: `Notification ${index}`,
  message: `Message ${index}`,
  data: { orderId: `order-${index}` },
  dedupeKey,
});

describe('NotificationsService', () => {
  const setup = (users: Array<{ id: string; role: string; isActive: boolean }> = []) => {
    const { prisma, rows } = createInMemoryNotificationsPrisma(users);
    const service = new NotificationsService(prisma as unknown as PrismaService);
    const client = prisma as unknown as PrismaService;
    return { prisma, rows, service, client };
  };

  describe('creating notifications', () => {
    it('skips duplicate dedupe keys for the same recipient', async () => {
      const { service, client, rows, prisma } = setup();

      await service.create(client, notificationFor('user-1', 1, 'order-placed:order-1'));
      const second = await service.create(
        client,
        notificationFor('user-1', 1, 'order-placed:order-1'),
      );

      expect(second).toBe(0);
      expect(rows).toHaveLength(1);
      expect(prisma.notification.createMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
    });

    it('allows the same dedupe key for different recipients and never dedupes null keys', async () => {
      const { service, client, rows } = setup();

      await service.create(client, [
        notificationFor('admin-1', 1, 'vendor-pending:vendor-1'),
        notificationFor('admin-2', 1, 'vendor-pending:vendor-1'),
        notificationFor('user-1', 2),
        notificationFor('user-1', 3),
      ]);

      expect(rows).toHaveLength(4);
    });

    it('does not query the database for an empty batch', async () => {
      const { service, client, prisma } = setup();

      await expect(service.create(client, [])).resolves.toBe(0);
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('fans admin notifications out to active administrators only', async () => {
      const { service, client, rows } = setup([
        { id: 'admin-1', role: 'ADMIN', isActive: true },
        { id: 'admin-2', role: 'ADMIN', isActive: false },
        { id: 'vendor-1', role: 'VENDOR', isActive: true },
      ]);

      await service.notifyAdmins(client, {
        type: NotificationType.VENDOR_PENDING_APPROVAL,
        title: 'Vendor awaiting approval',
        message: 'A vendor registered',
        dedupeKey: 'vendor-pending:vendor-9',
      });

      expect(rows.map((row) => row.userId)).toEqual(['admin-1']);
    });
  });

  describe('listing notifications', () => {
    it('returns only the caller\'s notifications, newest first, with pagination metadata', async () => {
      const { service, client } = setup();
      for (let index = 1; index <= 5; index += 1) {
        await service.create(client, notificationFor('user-1', index));
      }
      await service.create(client, notificationFor('user-2', 99));

      const firstPage = await service.listForUser('user-1', query({ page: 1, limit: 2 }));
      const lastPage = await service.listForUser('user-1', query({ page: 3, limit: 2 }));

      expect(firstPage).toMatchObject({
        success: true,
        count: 2,
        total: 5,
        page: 1,
        limit: 2,
        totalPages: 3,
      });
      expect(firstPage.notifications.map((item) => item.title)).toEqual([
        'Notification 5',
        'Notification 4',
      ]);
      expect(lastPage.notifications.map((item) => item.title)).toEqual([
        'Notification 1',
      ]);
    });

    it('caps the page size at 50', async () => {
      const { service, client, prisma } = setup();
      await service.create(
        client,
        Array.from({ length: 60 }, (_, index) => notificationFor('user-1', index)),
      );

      const result = await service.listForUser('user-1', query({ limit: 500 }));

      expect(result.limit).toBe(MAX_NOTIFICATIONS_PAGE_SIZE);
      expect(result.count).toBe(50);
      expect(result.total).toBe(60);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });

    it('filters unread notifications and never returns internal fields', async () => {
      const { service, client, rows } = setup();
      await service.create(client, [
        notificationFor('user-1', 1, 'key-1'),
        notificationFor('user-1', 2, 'key-2'),
      ]);
      rows[0].isRead = true;

      const result = await service.listForUser('user-1', query({ unreadOnly: true }));

      expect(result.total).toBe(1);
      expect(result.notifications[0]).not.toHaveProperty('userId');
      expect(result.notifications[0]).not.toHaveProperty('dedupeKey');
    });
  });

  describe('read state', () => {
    it('counts unread notifications for the caller only', async () => {
      const { service, client, rows } = setup();
      await service.create(client, [
        notificationFor('user-1', 1),
        notificationFor('user-1', 2),
        notificationFor('user-2', 3),
      ]);
      rows[0].isRead = true;

      await expect(service.getUnreadCount('user-1')).resolves.toEqual({
        success: true,
        unreadCount: 1,
      });
    });

    it('marks one notification as read and keeps the original read time on repeat', async () => {
      const { service, client, rows } = setup();
      await service.create(client, notificationFor('user-1', 1));

      const first = await service.markAsRead('user-1', rows[0].id);
      const readAt = rows[0].readAt;
      const second = await service.markAsRead('user-1', rows[0].id);

      expect(first.notification).toMatchObject({ isRead: true });
      expect(readAt).toBeInstanceOf(Date);
      expect(second.notification.readAt).toBe(readAt);
    });

    it('marks all of the caller\'s notifications as read', async () => {
      const { service, client, rows } = setup();
      await service.create(client, [
        notificationFor('user-1', 1),
        notificationFor('user-1', 2),
        notificationFor('user-2', 3),
      ]);

      const result = await service.markAllAsRead('user-1');

      expect(result).toMatchObject({ success: true, updated: 2 });
      expect(rows.filter((row) => row.userId === 'user-2' && row.isRead)).toHaveLength(0);
    });
  });

  describe('ownership isolation', () => {
    it('does not let a user read, mark, or delete another user\'s notification', async () => {
      const { service, client, rows } = setup();
      await service.create(client, notificationFor('owner', 1));
      const id = rows[0].id;

      await expect(service.markAsRead('intruder', id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove('intruder', id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const intruderList = await service.listForUser('intruder', query());

      expect(intruderList.total).toBe(0);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ isRead: false, readAt: null });
    });

    it('deletes the caller\'s own notification', async () => {
      const { service, client, rows } = setup();
      await service.create(client, notificationFor('owner', 1));

      await expect(service.remove('owner', rows[0].id)).resolves.toMatchObject({
        success: true,
      });
      expect(rows).toHaveLength(0);
      await expect(service.remove('owner', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
