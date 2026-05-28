# Menuverse Deployment Guide

Last updated: May 2026. Production architecture is Supabase-native.

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
VITE_ENABLE_SERVER_RECOMMENDATIONS=false
VITE_ENABLE_CLIENT_FEEDBACK_ANALYSIS=false
VITE_ENABLE_KOT_EDGE_PRINT=false
VITE_ENABLE_WHATSAPP_EDGE_NOTIFICATIONS=false
VITE_ENABLE_POS_EDGE_SYNC=false
VITE_ENABLE_AR_EDGE_PROCESSING=false
VITE_ENABLE_DELIVERY_QUOTE_EDGE=false
```

Keep the optional Edge Function flags `false` until the matching functions are deployed to the active Supabase project. This prevents browser CORS noise for non-critical features such as recommendations, KOT print queueing, local feedback-analysis fallback, and delivery quoting.

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
APP_ORIGIN=https://menu-verse-admin.vercel.app
ALLOWED_ORIGINS=https://menu-verse-admin.vercel.app,https://menu-verse.vercel.app,https://your-project.supabase.co
MENUVERSE_INTERNAL_SECRET=shared-secret-for-server-to-server-function-calls
RESEND_API_KEY=server-only
RESEND_FROM_EMAIL=Menuverse <no-reply@your-domain.com>
SQUARE_VERSION=2026-05-20
SHIPROCKET_API_TOKEN=server-only
SHIPROCKET_PICKUP_POSTCODE=110030
WHATSAPP_VERIFY_TOKEN=shared-webhook-verify-token
WHATSAPP_DEFAULT_RESTAURANT_ID=restaurant-id-for-single-number
WHATSAPP_RESTAURANT_MAP={"919999999999":"restaurant-id"}
WHATSAPP_INBOUND_REPLY_WEBHOOK_URL=https://provider.example/send
REPLICATE_API_TOKEN=server-only
REPLICATE_MODEL=stability-ai/triposr
REPLICATE_MODEL_VERSION=
REPLICATE_CANCEL_AFTER=20m
```

Never expose service role, payment secret, or webhook secret values to Vite.

## 3. Database

Run all SQL migrations under `supabase/migrations/`, then run:

```sql
-- Supabase SQL editor
\i supabase/rls-policies.sql
```

If using the dashboard SQL editor, paste the contents of `supabase/rls-policies.sql`.

Database workers that invoke Edge Functions need the project URL and internal secret available as database settings:

```sql
alter database postgres set "app.settings.supabase_url" = 'https://your-project.supabase.co';
alter database postgres set "app.settings.menuverse_internal_secret" = 'same-value-as-MENUVERSE_INTERNAL_SECRET';
```

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

The `ar-models` bucket stores GLB, USDZ, and thumbnail assets for the AR menu preview feature. The `ar-source-videos` bucket stores source videos for photogrammetry jobs. The `menu-images` and `restaurant-assets` buckets store optimized menu photos and logos.

## 4. Edge Functions

```bash
supabase functions deploy create-payment-order
supabase functions deploy verify-payment-webhook
supabase functions deploy invite-staff
supabase functions deploy analyse-feedback
supabase functions deploy request-kitchen-print
supabase functions deploy send-whatsapp-notification
supabase functions deploy sync-to-pos
supabase functions deploy delivery-quote
supabase functions deploy whatsapp-inbound
supabase functions deploy process-ar-asset
supabase functions deploy pos-adapter-square
```

For browser-called functions, deploy with JWT verification disabled so `OPTIONS` preflight reaches the handler:

```bash
supabase functions deploy analyse-feedback get-recommendations request-kitchen-print --project-ref gdlsgscmrgtadqrwtwgg --no-verify-jwt --use-api
```

If the browser reports `Requested function was not found`, the function has not been deployed to that Supabase project yet.

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

## 6. Data Access

The production app uses the Supabase JS client, Supabase RPC functions, and Edge Functions as its data access layer. Do not deploy a separate legacy application server for MVP QR ordering.

## Known Production TODOs

- Complete Razorpay Orders API creation and webhook signature verification.
- Replace static table-only QR joins with staff-issued, session-specific QR links for restaurants that need stricter bill privacy.
- Add a printer/KOT Edge Function or webhook target.
- Add WhatsApp notification provider calls behind Edge Functions.
- Add richer analytics materialized views once live order data exists.
