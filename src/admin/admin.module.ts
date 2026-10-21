
import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { ProductsModule } from '../products/products.module';
@Module({
  imports: [
  PrismaModule,
  MailModule,
  ProductsModule,
],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}