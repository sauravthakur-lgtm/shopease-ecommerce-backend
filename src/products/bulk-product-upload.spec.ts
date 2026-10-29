import { BadRequestException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { ProductsService } from './products.service';
import {
  BULK_PRODUCT_UPLOAD_MAX_SIZE,
  BULK_PRODUCT_UPLOAD_MAX_ROWS,
  parseCsv,
  validateProductCsv,
} from './bulk-product-upload';
import { bulkProductUploadOptions } from './bulk-product-upload-options';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const csv = (body: string) =>
  Buffer.from(`name,description,category,price,stock,imageUrl\n${body}`, 'utf8');

describe('bulk product CSV validation', () => {
  it('parses quoted commas and line breaks in valid UTF-8 fields', () => {
    const rows = parseCsv(
      Buffer.from('name,description\n"Tote","A useful bag,\nfor daily errands"\n'),
    );

    expect(rows[1]).toEqual(['Tote', 'A useful bag,\nfor daily errands']);
  });

  it('accepts a valid row and applies the existing DTO rules', () => {
    const [candidate] = validateProductCsv(
      csv('"Canvas Tote","Roomy, durable","Clothing",19.99,4,'),
    );

    expect(candidate.errors).toEqual([]);
    expect(candidate.dto).toMatchObject({
      name: 'Canvas Tote',
      description: 'Roomy, durable',
      category: 'Clothing',
      price: 19.99,
      stock: 4,
    });
  });

  it('rejects missing required columns and unexpected columns', () => {
    expect(() =>
      validateProductCsv(Buffer.from('name,price,stock\nItem,5,1')),
    ).toThrow(BadRequestException);
    expect(() =>
      validateProductCsv(
        Buffer.from('name,category,price,stock,vendorId\nItem,Clothes,5,1,other'),
      ),
    ).toThrow(/Unsupported CSV column/);
  });

  it('reports missing required fields, invalid price, stock, and category', () => {
    const [candidate] = validateProductCsv(csv(',,,-1,-2,'));
    const fields = candidate.errors.map((error) => error.field);

    expect(fields).toContain('name');
    expect(fields).toContain('category');
    expect(fields).toContain('price');
    expect(fields).toContain('stock');
  });

  it('rejects non-numeric and fractional stock values', () => {
    const [nonNumeric] = validateProductCsv(csv('Item,Description,Clothes,2,abc,'));
    const [fractional] = validateProductCsv(csv('Item,Description,Clothes,2,1.5,'));
    const [blank] = validateProductCsv(csv('Item,Description,Clothes,2,,'));

    expect(nonNumeric.errors.some((error) => error.field === 'stock')).toBe(true);
    expect(fractional.errors.some((error) => error.field === 'stock')).toBe(true);
    expect(blank.errors.some((error) => error.field === 'stock')).toBe(true);
  });

  it('rejects malformed quoting and invalid UTF-8', () => {
    expect(() => parseCsv(Buffer.from('name,description\nItem,"not closed'))).toThrow(
      /unterminated quoted field/,
    );
    expect(() => parseCsv(Buffer.from([0xc3, 0x28]))).toThrow(/valid UTF-8/);
  });

  it('enforces the configured upload size and maximum row count', () => {
    expect(bulkProductUploadOptions.limits?.fileSize).toBe(2 * 1024 * 1024);
    expect(() => parseCsv(Buffer.alloc(BULK_PRODUCT_UPLOAD_MAX_SIZE + 1))).toThrow(
      /2 MiB upload limit/,
    );
    const header = 'name,category,price,stock\n';
    const rows = Array.from({ length: BULK_PRODUCT_UPLOAD_MAX_ROWS + 1 }, () =>
      'Item,Clothes,1,0',
    ).join('\n');

    expect(() => validateProductCsv(Buffer.from(header + rows))).toThrow(
      /exceeds the limit/,
    );
  });

  it('rejects non-CSV upload file types', () => {
    const fileFilter = bulkProductUploadOptions.fileFilter;
    if (!fileFilter) throw new Error('CSV file filter is required.');

    const callback = jest.fn();
    fileFilter(
      {} as never,
      { originalname: 'products.xlsx', mimetype: 'application/vnd.ms-excel' } as Express.Multer.File,
      callback,
    );

    expect(callback).toHaveBeenCalledWith(
      expect.any(BadRequestException),
      false,
    );
  });
});

describe('ProductsService bulk product import', () => {
  const createService = (
    existingProducts: Array<{ name: string; category: string | null }> = [],
  ) => {
    const prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue(existingProducts),
        create: jest.fn().mockResolvedValue({ id: 'created-product' }),
      },
    } as unknown as PrismaService;
    const service = new ProductsService(
      prisma,
      {} as RedisService,
    );
    return { prisma, service };
  };

  it('validates without creating products and imports valid rows only', async () => {
    const { prisma, service } = createService();
    const file = {
      buffer: csv('Imported,Valid,Clothes,15.00,2,\nMissing,Description,,15,2,'),
    } as Express.Multer.File;

    const preview = await service.bulkUploadProducts('vendor-1', file, true);
    expect(preview).toMatchObject({ totalRows: 2, validRows: 1, failedRows: 1 });
    expect(prisma.product.create).not.toHaveBeenCalled();

    const result = await service.bulkUploadProducts('vendor-1', file);
    expect(result).toMatchObject({ totalRows: 2, successful: 1, failed: 1 });
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vendorId: 'vendor-1',
          status: ProductStatus.PENDING,
        }),
      }),
    );
  });

  it('prevents duplicate rows and re-imports for the same vendor', async () => {
    const { prisma, service } = createService([
      { name: 'Canvas Tote', category: 'Clothes' },
    ]);
    const file = {
      buffer: csv('Canvas Tote,First,Clothes,15,2,\nCanvas Tote,Second,Clothing,16,3,'),
    } as Express.Multer.File;

    const result = await service.bulkUploadProducts('vendor-1', file);

    expect(result).toMatchObject({ successful: 0, failed: 2 });
    expect(prisma.product.create).not.toHaveBeenCalled();
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ vendorId: 'vendor-1' }),
      }),
    );
  });

  it('imports only the first matching product key in a CSV file', async () => {
    const { prisma, service } = createService();
    const result = await service.bulkUploadProducts('vendor-1', {
      buffer: csv('Canvas Tote,First,Clothes,15,2,\ncanvas tote,Second,Clothing,16,3,'),
    } as Express.Multer.File);

    expect(result).toMatchObject({ successful: 1, failed: 1 });
    expect(prisma.product.create).toHaveBeenCalledTimes(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ row: 3, field: 'name' }),
    ]);
  });

  it('derives product ownership from the authenticated vendor, not CSV fields', async () => {
    const { prisma, service } = createService();
    const result = await service.bulkUploadProducts('jwt-vendor', {
      buffer: csv('Owned Item,Description,Electronics,2,1,'),
    } as Express.Multer.File);

    expect(result).toMatchObject({ successful: 1, failed: 0 });
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ vendorId: 'jwt-vendor' }),
      }),
    );
  });
});
