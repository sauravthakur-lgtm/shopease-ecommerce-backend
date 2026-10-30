import {
  NotificationType,
  OrderStatus,
  Prisma,
  ProductStatus,
} from '@prisma/client';
import type {
  AdminNotificationInput,
  NotificationInput,
} from './notifications.service';

// Builders for every business notification. Each one fixes the recipient,
// stores only identifiers and status values, and defines the dedupe key.

type OrderRef = {
  id: string;
  customerId: string;
  totalAmount: Prisma.Decimal;
};

type ProductRef = {
  id: string;
  name: string;
  vendorId: string;
  updatedAt: Date;
};

export function orderPlacedNotification(
  order: OrderRef & { status: OrderStatus },
): NotificationInput {
  return {
    userId: order.customerId,
    type: NotificationType.ORDER_PLACED,
    title: 'Order placed',
    message: `Your order ${order.id} has been placed successfully. Total amount: Rs. ${order.totalAmount.toFixed(2)}.`,
    data: { orderId: order.id, status: order.status },
    dedupeKey: `order-placed:${order.id}`,
  };
}

/**
 * previousUpdatedAt is the order version the change was applied to, so the key
 * identifies one specific transition rather than every move to the same status.
 */
export function orderStatusChangedNotification(
  order: { id: string; customerId: string },
  previousStatus: OrderStatus,
  status: OrderStatus,
  previousUpdatedAt: Date,
): NotificationInput {
  return {
    userId: order.customerId,
    type: NotificationType.ORDER_STATUS_CHANGED,
    title: 'Order status updated',
    message: `Your order ${order.id} status changed from ${previousStatus} to ${status}.`,
    data: { orderId: order.id, previousStatus, status },
    dedupeKey: `order-status:${order.id}:${previousUpdatedAt.getTime()}:${status}`,
  };
}

export function paymentSucceededNotification(
  order: OrderRef,
  razorpayPaymentId: string,
): NotificationInput {
  return {
    userId: order.customerId,
    type: NotificationType.PAYMENT_SUCCEEDED,
    title: 'Payment successful',
    message: `Your payment of Rs. ${order.totalAmount.toFixed(2)} for order ${order.id} was successful. Your order is confirmed.`,
    data: { orderId: order.id, status: OrderStatus.CONFIRMED },
    dedupeKey: `payment-succeeded:${razorpayPaymentId}`,
  };
}

export function paymentFailedNotification(
  order: { id: string; customerId: string },
  razorpayPaymentId: string,
): NotificationInput {
  return {
    userId: order.customerId,
    type: NotificationType.PAYMENT_FAILED,
    title: 'Payment failed',
    message: `A payment attempt for order ${order.id} failed. Your order is still pending, and you can try paying again.`,
    data: { orderId: order.id, status: OrderStatus.PENDING },
    dedupeKey: `payment-failed:${razorpayPaymentId}`,
  };
}

export function productApprovedNotification(
  product: ProductRef,
): NotificationInput {
  return {
    userId: product.vendorId,
    type: NotificationType.PRODUCT_APPROVED,
    title: 'Product approved',
    message: `Your product "${product.name}" has been approved and is now visible to customers.`,
    data: { productId: product.id, status: ProductStatus.APPROVED },
    dedupeKey: `product-approved:${product.id}:${product.updatedAt.getTime()}`,
  };
}

export function productRejectedNotification(
  product: ProductRef,
  reason?: string,
): NotificationInput {
  return {
    userId: product.vendorId,
    type: NotificationType.PRODUCT_REJECTED,
    title: 'Product rejected',
    message: reason
      ? `Your product "${product.name}" was rejected. Reason: ${reason}`
      : `Your product "${product.name}" was rejected.`,
    data: {
      productId: product.id,
      status: ProductStatus.REJECTED,
      ...(reason ? { reason } : {}),
    },
    dedupeKey: `product-rejected:${product.id}:${product.updatedAt.getTime()}`,
  };
}

export function productPendingReviewNotification(
  product: { id: string; name: string; vendorId: string },
  version: Date,
  change: 'created' | 'updated',
): AdminNotificationInput {
  return {
    type: NotificationType.PRODUCT_PENDING_REVIEW,
    title: 'Product awaiting review',
    message:
      change === 'created'
        ? `New product "${product.name}" is awaiting approval.`
        : `Product "${product.name}" was edited by its vendor and is awaiting approval.`,
    data: { productId: product.id, vendorId: product.vendorId },
    dedupeKey: `product-review:${product.id}:${version.getTime()}`,
  };
}

export function bulkProductsPendingReviewNotification(
  vendorId: string,
  productIds: string[],
): AdminNotificationInput {
  return {
    type: NotificationType.PRODUCT_PENDING_REVIEW,
    title: 'Products awaiting review',
    message: `${productIds.length} product${productIds.length === 1 ? '' : 's'} from a bulk upload ${productIds.length === 1 ? 'is' : 'are'} awaiting approval.`,
    data: { vendorId, productCount: productIds.length },
    dedupeKey: `product-bulk-review:${productIds[0]}`,
  };
}

export function vendorPendingApprovalNotification(vendor: {
  id: string;
  name: string;
}): AdminNotificationInput {
  return {
    type: NotificationType.VENDOR_PENDING_APPROVAL,
    title: 'Vendor awaiting approval',
    message: `Vendor "${vendor.name}" has registered and is awaiting approval.`,
    data: { vendorId: vendor.id },
    dedupeKey: `vendor-pending:${vendor.id}`,
  };
}

export function vendorApprovedNotification(vendor: {
  id: string;
  updatedAt: Date;
}): NotificationInput {
  return {
    userId: vendor.id,
    type: NotificationType.VENDOR_APPROVED,
    title: 'Vendor account approved',
    message: 'Your vendor account has been approved. You can now manage your products.',
    data: { vendorId: vendor.id },
    dedupeKey: `vendor-approved:${vendor.id}:${vendor.updatedAt.getTime()}`,
  };
}
