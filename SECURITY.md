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

The current functions are safe placeholders. Live payment settlement must verify provider signatures server-side before updating `Payment` or `SessionBill`.

## Abuse Protection

Current protections include table session token validation, pending-order limits, waiter-request cooldowns, idempotency keys, and RLS denial of direct sensitive public writes. Production should add IP/device-level rate limiting at the Edge Function layer.

Team member removal is performed through `remove_staff_member_secure`; only the restaurant owner can remove manager/staff profiles for the same restaurant.
