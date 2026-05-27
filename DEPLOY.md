# Menuverse Deployment Guide

Last updated: May 2026. Production architecture is Supabase-native; Express/Prisma is deprecated.

## 1. Frontend Hosting

Deploy the Vite app to Vercel, Netlify, or another static host.

```bash
npm ci
npm run build
```

`vercel.json` already includes an SPA rewrite.

## 2. Environment Variables

Frontend:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_APP_TYPE=all
VITE_CUSTOMER_APP_URL=https://your-domain.com
```

Edge Function secrets:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=server-only-secret
RAZORPAY_WEBHOOK_SECRET=server-only-webhook-secret
ANTHROPIC_API_KEY=server-only-key
ANTHROPIC_MODEL=claude-3-5-haiku-20241022
WHATSAPP_ACCESS_TOKEN=server-only-token
WHATSAPP_WEBHOOK_URL=https://provider.example/send
KOT_WEBHOOK_URL=https://printer-provider.example/print
POS_WEBHOOK_URL=https://pos-provider.example/orders
APP_ORIGIN=https://your-domain.com
```

Never expose service role, payment secret, or webhook secret values to Vite.

## 3. Database

Run all SQL migrations under `supabase/migrations/`, then run:

```sql
-- Supabase SQL editor
\i supabase/rls-policies.sql
```

If using the dashboard SQL editor, paste the contents of `supabase/rls-policies.sql`.

The secure MVP order path depends on these RPC functions:

- `start_table_session`
- `create_order_secure`
- `get_order_status_secure`
- `get_table_session_orders`
- `create_staff_request_secure`
- `submit_order_feedback_secure`
- `upsert_guest_contact_secure`
- `admin_feedback_insights`
- `recalculate_menu_rankings`
- `close_table_session`
- `remove_staff_member_secure`

## Storage Buckets

The `ar-models` bucket is created automatically by migration `20260526000000_create_ar_models_bucket.sql`.
The `restaurant-assets` bucket is created automatically by migration `20260526000004_audit_gap_foundations.sql`.

If you are using the Supabase dashboard instead of migrations:
1. Go to Storage → New Bucket
2. Name: `ar-models`
3. Public bucket: **Yes**
4. File size limit: 20 MB
5. Allowed MIME types: `model/gltf-binary, model/vnd.usdz+zip, application/octet-stream, image/jpeg, image/png, image/webp`

The `ar-models` bucket stores GLB, USDZ, and thumbnail assets for the AR menu preview feature. The `restaurant-assets` bucket stores logos and menu photos.

## 4. Edge Functions

```bash
supabase functions deploy create-payment-order
supabase functions deploy verify-payment-webhook
supabase functions deploy invite-staff
supabase functions deploy analyse-feedback
supabase functions deploy request-kitchen-print
supabase functions deploy send-whatsapp-notification
supabase functions deploy sync-to-pos
```

`create-payment-order` creates Razorpay Orders with server-side credentials. `verify-payment-webhook` verifies Razorpay signatures before any payment or bill is marked paid.

`analyse-feedback` uses `ANTHROPIC_API_KEY` when configured and falls back to a deterministic rating/keyword baseline when it is not. `request-kitchen-print`, `send-whatsapp-notification`, and `sync-to-pos` queue integration jobs and forward to provider webhooks when those URLs are configured.

If the dashboard shows a CORS preflight error for `invite-staff`, redeploy the functions after `supabase/config.toml` is present. The function-level `verify_jwt = false` lets browser `OPTIONS` preflight reach the handler; the function still validates the caller's JWT and owner role before sending any invite.

## 5. Storage

The latest migrations create public `restaurant-assets` and `ar-models` buckets with restaurant-folder-scoped write policies. If you are not running migrations, create a public `restaurant-assets` bucket for logos/menu photos and keep writes authenticated and restaurant-folder scoped:

```sql
create policy "restaurant_asset_upload"
on storage.objects for insert
with check (
  bucket_id = 'restaurant-assets'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[2] in (
    select restaurant_id from "User" where id = auth.uid()::text
  )
);

create policy "restaurant_asset_public_read"
on storage.objects for select
using (bucket_id = 'restaurant-assets');
```

## 6. Legacy Backend

`server/index.js` and `prisma/schema.prisma` are retained only for reference while migrating historical logic. Do not deploy them for the MVP production app.

## Known Production TODOs

- Complete Razorpay Orders API creation and webhook signature verification.
- Replace static table-only QR joins with staff-issued, session-specific QR links for restaurants that need stricter bill privacy.
- Add a printer/KOT Edge Function or webhook target.
- Add WhatsApp notification provider calls behind Edge Functions.
- Add richer analytics materialized views once live order data exists.
