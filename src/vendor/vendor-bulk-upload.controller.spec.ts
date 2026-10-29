import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { ProfileService } from '../profiles/profile.service';
import { ProductsService } from '../products/products.service';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';

class TestJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & {
      user?: { userId: string; role: string };
    }>();
    const authorization = request.headers.authorization;
    if (!authorization) throw new UnauthorizedException();

    request.user = authorization === 'Bearer vendor-token'
      ? { userId: 'authenticated-vendor', role: 'VENDOR' }
      : { userId: 'customer-user', role: 'CUSTOMER' };
    return true;
  }
}

describe('Vendor bulk upload authorization', () => {
  let app: INestApplication;
  const bulkUploadProducts = jest.fn().mockResolvedValue({
    success: true,
    totalRows: 1,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [VendorController],
      providers: [
        RolesGuard,
        { provide: ProfileService, useValue: {} },
        { provide: VendorService, useValue: {} },
        { provide: ProductsService, useValue: { bulkUploadProducts } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(TestJwtGuard)
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => bulkUploadProducts.mockClear());

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/api/vendor/products/bulk-upload')
      .expect(401);
    expect(bulkUploadProducts).not.toHaveBeenCalled();
  });

  it('rejects authenticated non-vendor users', async () => {
    await request(app.getHttpServer())
      .post('/api/vendor/products/bulk-upload')
      .set('Authorization', 'Bearer customer-token')
      .expect(403);
    expect(bulkUploadProducts).not.toHaveBeenCalled();
  });

  it('uses the authenticated vendor identity for import ownership', async () => {
    await request(app.getHttpServer())
      .post('/api/vendor/products/bulk-upload?validateOnly=true')
      .set('Authorization', 'Bearer vendor-token')
      .attach('file', Buffer.from('name,category,price,stock\nItem,Clothes,1,1'), {
        filename: 'products.csv',
        contentType: 'text/csv',
      })
      .expect(201);

    expect(bulkUploadProducts).toHaveBeenCalledWith(
      'authenticated-vendor',
      expect.objectContaining({ originalname: 'products.csv' }),
      true,
    );
  });
});
