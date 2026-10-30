import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from './auth.service';
import { RegisterDto, RegisterRole } from './dto/register.dto';
import { createInMemoryNotificationsPrisma } from '../../test/support/in-memory-notifications';

describe('AuthService vendor registration notifications', () => {
  const setup = () => {
    const store = createInMemoryNotificationsPrisma([
      { id: 'admin-1', role: 'ADMIN', isActive: true },
      { id: 'admin-2', role: 'ADMIN', isActive: true },
      { id: 'admin-retired', role: 'ADMIN', isActive: false },
    ]);
    const tx = {
      user: {
        create: jest.fn(({ data }: { data: { name: string; email: string; role: string; isActive: boolean } }) =>
          Promise.resolve({
            id: 'new-user',
            name: data.name,
            email: data.email,
            role: data.role,
            isActive: data.isActive,
            createdAt: new Date('2026-10-30T09:00:00.000Z'),
          }),
        ),
        findMany: store.prisma.user.findMany,
      },
      notification: store.prisma.notification,
    };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
    };
    const mailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      prisma as unknown as PrismaService,
      {} as JwtService,
      mailService as unknown as MailService,
      new NotificationsService(prisma as unknown as PrismaService),
    );
    return { service, store, tx, mailService };
  };

  const registration = (role: RegisterRole): RegisterDto => ({
    name: ' Lamp Co ',
    email: 'Vendor@Example.com',
    password: 'Secret123!',
    role,
  });

  it('notifies every active admin about a new vendor awaiting approval', async () => {
    const { service, store, mailService } = setup();

    const result = await service.register(registration(RegisterRole.VENDOR));

    expect(result).toMatchObject({
      success: true,
      message: 'Registration successful',
      user: { id: 'new-user', role: 'VENDOR', isActive: false },
    });
    expect(store.rows.map((row) => row.userId).sort()).toEqual(['admin-1', 'admin-2']);
    for (const row of store.rows) {
      expect(row).toMatchObject({
        type: NotificationType.VENDOR_PENDING_APPROVAL,
        data: { vendorId: 'new-user' },
        dedupeKey: 'vendor-pending:new-user',
      });
      expect(JSON.stringify(row)).not.toContain('example.com');
    }
    expect(mailService.sendEmail).not.toHaveBeenCalled();
  });

  it('does not notify admins about customer registrations', async () => {
    const { service, store, mailService } = setup();

    await service.register(registration(RegisterRole.CUSTOMER));

    expect(store.rows).toHaveLength(0);
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('creates no notification when the account cannot be created', async () => {
    const { service, store, tx } = setup();
    tx.user.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await expect(
      service.register(registration(RegisterRole.VENDOR)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(store.rows).toHaveLength(0);
  });
});
