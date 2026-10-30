import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsWebhookController } from './payments-webhook.controller';

@Module({
  imports: [PrismaModule, MailModule, NotificationsModule],
  controllers: [PaymentsController, PaymentsWebhookController],
  providers: [PaymentsService],
})
export class PaymentsModule {}