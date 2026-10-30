<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Profile API

Authenticated customers use the existing `GET` and `PATCH /api/customer/profile` routes; the GET response continues to include saved addresses. Admins use `GET` and `PATCH /api/admin/profile`, and vendors use `GET` and `PATCH /api/vendor/profile`. Each route requires a bearer JWT with the matching role and derives the profile user ID from that token.

PATCH accepts only `name`, `phone`, and an optional `profileImage` URL (or `null` to clear the URL). Email, role, account status, password, and other fields cannot be changed through these endpoints. Upload a profile image as multipart form data with field `image` to `POST /api/customer/profile/image`, `/api/vendor/profile/image`, or `/api/admin/profile/image`, using the corresponding role token. JPEG, PNG, and WebP files up to 5 MiB are accepted; the server validates both declared content type and file signature, stores a UUID-named file in `uploads/profiles`, and persists its relative `/uploads/profiles/...` URL in the existing `User.profileImage` column. Static images are served under `/uploads/profiles/`.

### Product editing and removal

- `PATCH /api/vendor/products/:id` allows a vendor to update `name`, `description`, `category`, `price`, `stock`, and/or `imageUrl` on their own product. Ownership is checked against the JWT user ID; vendors cannot set `status`, `vendorId`, or other protected fields. Vendor edits set the product back to `PENDING` for admin review.
- `DELETE /api/vendor/products/:id` deletes only the authenticated vendor's own product.
- `PATCH /api/admin/products/:id` allows admins to update the same product fields for any product. Product status is not mass-assigned; admins continue to use the existing approve endpoint for approval.
- `DELETE /api/admin/products/:id` allows admins to delete any product.

Products referenced by legacy orders or order items cannot be deleted (`409 Conflict`) so order history is preserved. Unreferenced products may be deleted; related cart, wishlist, and review rows follow the schema's existing cascade rules. Product updates use the existing category normalization and product-field validation. To make edits, send a JSON body containing only the fields to change, for example `{"price":24.99,"stock":12}`. A blank `description` or `imageUrl` clears that optional field.

### Vendor deactivation

`PATCH /api/admin/vendors/:id/deactivate` deactivates the selected vendor without deleting the account or order history. Existing approved products are set to `PENDING` so they are no longer listed publicly; they require admin approval if the vendor is later activated again. Authentication checks the current account state, so existing vendor JWTs stop working immediately. The existing `PATCH /api/admin/vendors/:id/approve` endpoint can activate the vendor again.

Customer addresses are created with `POST /api/customer/addresses`, updated with `PATCH /api/customer/addresses/:id` (send `{"isDefault":true}` to set the default), and deleted with `DELETE /api/customer/addresses/:id`. Deleting the default address automatically promotes the oldest remaining address.

### Vendor dashboard and sales

Vendor-only endpoints use the JWT subject as the vendor ID:

- `GET /api/vendor/dashboard?period=daily|weekly|monthly` returns own-product counts by approval status, low-stock count (stock at or below 5), distinct orders containing own products grouped by status, gross sales history, and best sellers.
- Optional `startDate` and `endDate` are validated ISO date query parameters and use the same inclusive UTC range rules as admin analytics.
- `GET /api/vendor/orders?page=1&limit=20` returns paginated orders with only the authenticated vendor's product lines. It does not expose customer details or full order totals.
- `PATCH /api/vendor/products/:id/stock` accepts `{"stock":12}` and only updates a product when both its ID and authenticated vendor ID match.

Vendor sales include only `CONFIRMED`, `SHIPPED`, and `DELIVERED` orders, matching existing admin paid-sales analytics; pending and cancelled orders are excluded. Multi-item order totals use `OrderItem.quantity * priceAtPurchase`; older orders without order items use their legacy product/quantity and `totalAmount + discountAmount`. Values are gross product line sales before order-level coupon discounts, because discounts are not attributed to lines/vendors. The schema has no commission, vendor-earnings, or payout model, so these metrics are not a payout or net earnings calculation.

### Vendor CSV bulk product upload

The vendor dashboard supports a two-step CSV workflow:

- `GET /api/vendor/products/bulk-upload/template` downloads the sample CSV. Requires a vendor bearer JWT.
- `POST /api/vendor/products/bulk-upload?validateOnly=true` validates the file and returns row previews without creating products.
- `POST /api/vendor/products/bulk-upload` (or `?validateOnly=false`) imports valid rows and returns a row-level result.

Send multipart form data with a single `file` field. The upload requires an authenticated `VENDOR` JWT; ownership always comes from the JWT and neither `vendorId` nor product status can be supplied in the CSV.

Required, lower-case CSV headers are `name`, `category`, `price`, and `stock`. `description` and `imageUrl` are optional. The template format is:

```csv
name,description,category,price,stock,imageUrl
"Everyday Tote","A roomy tote bag, made for daily errands","Clothes",29.99,25,
```

CSV text must be valid UTF-8. Quoted commas, escaped quotes, and embedded line breaks are supported. Unknown, duplicated, or missing required headers and malformed CSV structure are rejected. Price and stock use the existing `CreateProductDto` rules: price must be greater than zero with at most two decimal places; stock must be an integer from 0 to 1,000,000. Category is required, at most 100 characters, and uses the existing category normalization; known aliases are canonicalized and other non-empty names remain allowed. If supplied, `imageUrl` must match the existing local product-upload URL format; external URLs are not fetched. Every created product is `PENDING` for admin review.

Files are limited to 2 MiB and 500 product rows. The upload is held in memory only and is not retained. Each valid row is created sequentially using the existing product creation service. Invalid rows are not created; the response reports successful/failed counts and row, field, and message details. The validation response includes preview rows and their validity.

Duplicate detection is scoped to the authenticated vendor and compares trimmed, case-insensitive product names plus normalized categories. The first matching row in a file is eligible; later rows with the same key fail. A row matching an existing vendor product also fails, regardless of price or description. There is no database uniqueness constraint for this composite key, so simultaneous uploads can still race; the check prevents ordinary repeat imports but is not a global idempotency guarantee.

Example import response:

```json
{
  "success": false,
  "message": "Bulk import completed.",
  "totalRows": 2,
  "successful": 1,
  "failed": 1,
  "successfulRows": [2],
  "errors": [
    { "row": 3, "field": "price", "message": "price must not be less than 0.01" }
  ]
}
```

Malformed files and invalid headers return the standard NestJS `400` error response instead of a row result. Row validation errors use the `errors` array above. To test in Postman, sign in as an active vendor and copy the JWT; request the template using that bearer token; create a `POST` to the bulk-upload path with `Authorization: Bearer <token>` and `Body` → `form-data` → key `file` (type **File**); first set query `validateOnly=true` to inspect the preview, then submit the same file with `validateOnly=false` or no query to import. Admin approval remains a separate workflow. ZIP/image archive import and cross-upload locking are not supported.

## Notifications

In-app notifications are stored in the `Notification` table. Every endpoint requires a bearer JWT (any role) and only ever reads or changes the caller's own notifications; the recipient is never taken from the request.

- `GET /api/notifications?page=1&limit=20&unreadOnly=false` lists notifications newest first with `total`, `page`, `limit`, and `totalPages`. `limit` values above 50 are clamped to 50.
- `GET /api/notifications/unread-count` returns `{ "success": true, "unreadCount": 3 }`.
- `PATCH /api/notifications/read-all` marks all of the caller's notifications as read.
- `PATCH /api/notifications/:id/read` marks one notification as read. `DELETE /api/notifications/:id` deletes one. IDs must be UUIDs; another user's notification returns `404`.

Notifications are created by these events:

| Event | Recipient |
|---|---|
| Order placed (`POST /api/orders`, `POST /api/orders/checkout`) | Customer |
| Admin changes an order's status (only when it actually changes) | Customer |
| `POST /api/payments/verify` succeeds | Customer |
| Verified Razorpay `payment.failed` webhook for a pending order | Customer |
| Product approved or rejected (`PATCH /api/admin/products/:id/approve` / `reject`) | Product vendor |
| Vendor creates a product, or a vendor edit returns a reviewed product to `PENDING` | Active admins (one summary per CSV bulk import) |
| Vendor registers / vendor is approved | Active admins / the vendor |

Notifications are written in the same database transaction as the business change, so they only exist when that change commits; if the notification insert fails, the change is rolled back too. The CSV bulk-import summary is the exception: rows commit one at a time, so the summary is sent afterwards and a failure is only logged. Each event has a dedupe key that is unique per recipient, so repeated requests and webhook redeliveries do not create duplicates. Notification data holds only IDs and status values; no emails, phone numbers, addresses, tokens, or payment signatures are stored.

`PATCH /api/admin/products/:id/reject` rejects a `PENDING` product. It accepts an optional body `{"reason":"..."}` (at most 500 characters), which is included in the vendor's notification only and is not stored on the product.

### Razorpay payment webhook

`POST /api/payments/webhook` receives Razorpay webhooks without a JWT. It verifies the `X-Razorpay-Signature` header (HMAC SHA-256 of the exact raw request body) before reading the payload, and processes only `payment.failed`; other verified events are acknowledged and ignored. The failed payment is mapped to an order the same way `/api/payments/verify` does it: the Razorpay order is fetched from Razorpay and its `receipt` is the ShopEase order ID.

To enable it:

1. In the Razorpay Dashboard, open **Settings → Webhooks**, add `https://<your-host>/api/payments/webhook`, choose a secret, and enable the `payment.failed` event.
2. Add the same secret to `.env`:

   ```env
   RAZORPAY_WEBHOOK_SECRET=<webhook secret from the Razorpay dashboard>
   ```

   This is different from `RAZORPAY_KEY_SECRET`. Never commit the real value.
3. Restart the server. Until the variable is set, the webhook responds `503` and does nothing; the rest of the API is unaffected.

For local testing, Razorpay must be able to reach your machine, for example through a tunnel.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

To add it to this project:

```bash
$ npm install @nestjs/observe
```

Then follow the [setup guide](https://docs.nestjs.com/observability/overview) - it takes a single import and an app key.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
