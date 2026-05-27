# Menuverse

QR-based restaurant ordering for table service, kitchen display, and restaurant-owner operations.

## Current Architecture

Menuverse is a React 18 + Vite single-page app backed by Supabase:

- Supabase Auth for owner, manager, and staff login
- PostgreSQL with Row Level Security for restaurant-scoped data access
- Supabase RPC functions for trusted order/session logic
- Supabase Edge Functions for payment and staff-invite integration boundaries
- Supabase Realtime through `src/lib/socket.js`, which keeps a socket-like interface for existing screens
- Sentiment/ranking fields on menu items and feedback records for AI-assisted recommendations

The old `server/` Express and `prisma/` code is legacy reference material. It is not used by the active Vite app or production deployment.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Required client env:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_APP_TYPE=all
```

For local demos only, you may set `VITE_ALLOW_CLIENT_ORDER_FALLBACK=true`. Do not enable it in production.

## Supabase Setup

Run migrations in order, then apply `supabase/rls-policies.sql`.

Important production functions:

- `start_table_session`
- `create_order_secure`
- `get_order_status_secure`
- `get_table_session_orders`
- `create_staff_request_secure`
- `submit_order_feedback_secure`
- `close_table_session`
- `remove_staff_member_secure`

Deploy Edge Functions:

```bash
supabase functions deploy create-payment-order
supabase functions deploy verify-payment-webhook
supabase functions deploy invite-staff
supabase functions deploy analyse-feedback
supabase functions deploy request-kitchen-print
supabase functions deploy send-whatsapp-notification
supabase functions deploy sync-to-pos
```

## Development Commands

```bash
npm run lint
npm run test:unit
npm run build
npm audit --omit=dev
```

## Production Checklist

- Apply migrations and RLS policies before enabling public QR ordering.
- Verify owners, managers, and staff have `User.restaurant_id` set correctly.
- Use session-specific table links/tokens for occupied tables; static table QR scans no longer expose an active bill unless `open_session_join_enabled` is intentionally enabled.
- Keep service role keys only in Supabase Edge Function secrets.
- Set `APP_ORIGIN` in Supabase Edge Function secrets before production deploys so Edge Function CORS only allows your app domain.
- Configure Razorpay credentials only in Edge Function secrets.
- Confirm storage policies restrict writes by restaurant folder.
- Configure `ANTHROPIC_API_KEY` for LLM sentiment analysis; otherwise the app uses the built-in rating/keyword baseline.
- Configure provider webhooks for KOT, WhatsApp, and POS integrations before marking those integrations live.
- Keep `VITE_ALLOW_CLIENT_ORDER_FALLBACK` unset in production.
