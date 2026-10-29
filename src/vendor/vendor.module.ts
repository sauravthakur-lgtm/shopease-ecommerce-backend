import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfileService } from '../profiles/profile.service';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [PrismaModule, ProductsModule],
  controllers: [VendorController],
  providers: [ProfileService, VendorService],
})
export class VendorModule {}
