# Security Model

## Data Access

Restaurant-owner, manager, and staff access is scoped by `User.restaurant_id`. RLS policies use helper functions to ensure authenticated users can only read or mutate data for their assigned restaurant.

Public customers can read restaurant/menu/catalog data for QR ordering. They cannot directly read or write orders, order items, payments, bills, or staff requests.

## Table Sessions

QR scans start or resume a `TableSession` through `start_table_session`. The session token is stored on the customer device and is required for:

- Creating orders
- Reading order status
- Reading table bill/session orders
- Calling staff
- Submitting post-meal order feedback

If an active session already exists, the static table QR does not return the session token unless the caller already presents the valid token or the table has `open_session_join_enabled` intentionally enabled. Closing a table session invalidates the old token for new orders.

## Order Creation

The browser sends only item IDs, quantities, modifier option IDs, notes, restaurant ID, table ID, and the table session token. `create_order_secure` computes item prices, modifier prices, totals, and bill state inside a single database transaction.

The browser must never submit trusted `total_amount`, payment status, role permissions, or cross-restaurant IDs.

## Payments

The frontend cannot mark a payment successful. Payment creation and webhook verification live behind Supabase Edge Functions:

- `create-payment-order`
- `verify-payment-webhook`
- `create-stripe-payment-intent`
- `verify-stripe-webhook`

Payment webhook verification is fully implemented server-side. Razorpay callbacks use HMAC-SHA256 with timing-safe comparison in `verify-payment-webhook`, and Stripe callbacks use Stripe's signed webhook verification in `verify-stripe-webhook`, before either function updates `Payment` or `SessionBill`.

## Abuse Protection

Current protections include table session token validation, pending-order limits, waiter-request cooldowns, idempotency keys, RLS denial of direct sensitive public writes, a 30-per-hour feedback guard per table session, and hashed IP/session payment-creation limits for Razorpay and Stripe. Add provider-edge throttles for any new public endpoints before deployment.

Team member removal is performed through `remove_staff_member_secure`; only the restaurant owner can remove manager/staff profiles for the same restaurant.
