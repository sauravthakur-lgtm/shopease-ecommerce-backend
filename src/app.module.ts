
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { MailModule } from './mail/mail.module';
import { CartModule } from './cart/cart.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { PaymentsModule } from './payments/payments.module';
import { CustomerModule } from './customer/customer.module';
import { RedisModule } from './redis/redis.module';
import { ReviewsModule } from './reviews/reviews.module';
import { CouponsModule } from './coupons/coupons.module';
import { VendorModule } from './vendor/vendor.module';
import { NotificationsModule } from './notifications/notifications.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AdminModule,
    ProductsModule,
    OrdersModule,
    MailModule,
    CartModule,
    WishlistModule,
    PaymentsModule,
    CustomerModule,
    RedisModule,
    ReviewsModule,
    CouponsModule,
    VendorModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
