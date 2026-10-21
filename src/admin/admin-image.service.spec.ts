import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { AdminService } from './admin.service';

describe('AdminService.updateProductImage', () => {
  it('updates only imageUrl and preserves the product status and other fields', async () => {
    const product = {
      id: 'product-id',
      name: 'Approved product',
      imageUrl: '/uploads/products/new-image.png',
      status: 'APPROVED',
    };
    const updateProduct = jest.fn().mockResolvedValue(product);
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({ id: product.id }),
        update: updateProduct,
      },
    } as unknown as PrismaService;
    const productsService = {
      validateAndGetImageUrl: jest
        .fn()
        .mockResolvedValue(product.imageUrl),
    } as unknown as ProductsService;
    const service = new AdminService(
      prisma,
      {} as MailService,
      productsService,
    );

    const result = await service.updateProductImage(
      product.id,
      {} as Express.Multer.File,
    );

    expect(updateProduct).toHaveBeenCalledWith({
      where: { id: product.id },
      data: { imageUrl: product.imageUrl },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        status: true,
      },
    });
    expect(result.product).toEqual(product);
  });
});
