import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationType } from '@prisma/client';
import type { Request } from 'express';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { createInMemoryNotificationsPrisma } from '../../test/support/in-memory-notifications';

const users: Record<string, { userId: string; role: string }> = {
  'Bearer customer-token': { userId: 'customer-1', role: 'CUSTOMER' },
  'Bearer vendor-token': { userId: 'vendor-1', role: 'VENDOR' },
  'Bearer admin-token': { userId: 'admin-1', role: 'ADMIN' },
};

class TestJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & {
      user?: { userId: string; role: string };
    }>();
    const user = users[request.headers.authorization ?? ''];
    if (!user) throw new UnauthorizedException();

    request.user = user;
    return true;
  }
}

describe('NotificationsController', () => {
  let app: INestApplication;
  let store: ReturnType<typeof createInMemoryNotificationsPrisma>;
  let service: NotificationsService;

  const seed = async (userId: string, count: number) => {
    await service.create(
      store.prisma as unknown as PrismaService,
      Array.from({ length: count }, (_, index) => ({
        userId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: `Update ${index + 1}`,
        message: 'Your order status changed.',
      })),
    );
  };

  beforeEach(async () => {
    store = createInMemoryNotificationsPrisma();
    const module = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        RolesGuard,
        NotificationsService,
        { provide: PrismaService, useValue: store.prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtGuard)
      .compile();

    service = module.get(NotificationsService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
    await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .expect(401);
  });

  it('serves every role from the authenticated identity only', async () => {
    await seed('customer-1', 2);
    await seed('vendor-1', 1);

    const customer = await request(app.getHttpServer())
      .get('/api/notifications')
      .set('Authorization', 'Bearer customer-token')
      .expect(200);
    const vendor = await request(app.getHttpServer())
      .get('/api/notifications?userId=customer-1')
      .set('Authorization', 'Bearer vendor-token')
      .expect(400);
    const admin = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(customer.body).toMatchObject({ success: true, total: 2 });
    expect(vendor.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('userId')]),
    );
    expect(admin.body).toEqual({ success: true, unreadCount: 0 });
  });

  it('parses pagination and unreadOnly query values and clamps the limit', async () => {
    await seed('customer-1', 3);
    store.rows[0].isRead = true;

    const response = await request(app.getHttpServer())
      .get('/api/notifications?page=1&limit=500&unreadOnly=true')
      .set('Authorization', 'Bearer customer-token')
      .expect(200);

    expect(response.body).toMatchObject({ total: 2, limit: 50, page: 1 });
    await request(app.getHttpServer())
      .get('/api/notifications?limit=0')
      .set('Authorization', 'Bearer customer-token')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/notifications?unreadOnly=maybe')
      .set('Authorization', 'Bearer customer-token')
      .expect(400);
  });

  it('routes fixed paths before parameterized ones', async () => {
    await seed('customer-1', 2);

    const count = await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Authorization', 'Bearer customer-token')
      .expect(200);
    const readAll = await request(app.getHttpServer())
      .patch('/api/notifications/read-all')
      .set('Authorization', 'Bearer customer-token')
      .expect(200);

    expect(count.body.unreadCount).toBe(2);
    expect(readAll.body).toMatchObject({ success: true, updated: 2 });
  });

  it('validates notification IDs as UUIDs', async () => {
    await request(app.getHttpServer())
      .patch('/api/notifications/not-a-uuid/read')
      .set('Authorization', 'Bearer customer-token')
      .expect(400);
    await request(app.getHttpServer())
      .delete('/api/notifications/not-a-uuid')
      .set('Authorization', 'Bearer customer-token')
      .expect(400);
  });

  it('returns 404 when another user targets a notification they do not own', async () => {
    await seed('customer-1', 1);
    const id = store.rows[0].id;

    await request(app.getHttpServer())
      .patch(`/api/notifications/${id}/read`)
      .set('Authorization', 'Bearer vendor-token')
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/notifications/${id}`)
      .set('Authorization', 'Bearer vendor-token')
      .expect(404);
    expect(store.rows[0].isRead).toBe(false);

    await request(app.getHttpServer())
      .patch(`/api/notifications/${id}/read`)
      .set('Authorization', 'Bearer customer-token')
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/notifications/${id}`)
      .set('Authorization', 'Bearer customer-token')
      .expect(200);
    expect(store.rows).toHaveLength(0);
  });
});
