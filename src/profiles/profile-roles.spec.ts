import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminController } from '../admin/admin.controller';
import { CustomerController } from '../customer/customer.controller';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { VendorController } from '../vendor/vendor.controller';

describe('Profile controller role access', () => {
  const guard = new RolesGuard(new Reflector());

  const contextFor = (
    controller: Function,
    handlerName: string,
    role: 'ADMIN' | 'VENDOR' | 'CUSTOMER',
  ) => {
    const handler = controller.prototype[handlerName] as Function;
    return {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'authenticated-user', role } }),
      }),
    } as unknown as ExecutionContext;
  };

  it.each([
    [CustomerController, 'CUSTOMER', 'ADMIN'],
    [AdminController, 'ADMIN', 'VENDOR'],
    [VendorController, 'VENDOR', 'CUSTOMER'],
  ] as const)(
    '%s allows its own role and rejects another role',
    (controller, allowedRole, deniedRole) => {
      expect(
        guard.canActivate(contextFor(controller, 'getProfile', allowedRole)),
      ).toBe(true);
      expect(() =>
        guard.canActivate(contextFor(controller, 'getProfile', deniedRole)),
      ).toThrow(ForbiddenException);
    },
  );

  it.each([
    [CustomerController, 'CUSTOMER', 'ADMIN'],
    [AdminController, 'ADMIN', 'VENDOR'],
    [VendorController, 'VENDOR', 'CUSTOMER'],
  ] as const)(
    '%s applies the same role restriction to image uploads',
    (controller, allowedRole, deniedRole) => {
      expect(
        guard.canActivate(
          contextFor(controller, 'uploadProfileImage', allowedRole),
        ),
      ).toBe(true);
      expect(() =>
        guard.canActivate(
          contextFor(controller, 'uploadProfileImage', deniedRole),
        ),
      ).toThrow(ForbiddenException);
    },
  );

  it.each(['getDashboard', 'getVendorOrders', 'updateStock'] as const)(
    'restricts vendor dashboard operation %s to the VENDOR role',
    (handlerName) => {
      expect(
        guard.canActivate(
          contextFor(VendorController, handlerName, 'VENDOR'),
        ),
      ).toBe(true);
      expect(() =>
        guard.canActivate(
          contextFor(VendorController, handlerName, 'CUSTOMER'),
        ),
      ).toThrow(ForbiddenException);
      expect(() =>
        guard.canActivate(
          contextFor(VendorController, handlerName, 'ADMIN'),
        ),
      ).toThrow(ForbiddenException);
    },
  );
});
