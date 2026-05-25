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
WHATSAPP_ACCESS_TOKEN=server-only-token
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
- `close_table_session`
- `remove_staff_member_secure`

## Storage Buckets

The `ar-models` bucket is created automatically by migration `20260526000000_create_ar_models_bucket.sql`.

If you are using the Supabase dashboard instead of migrations:
1. Go to Storage → New Bucket
2. Name: `ar-models`
3. Public bucket: **Yes**
4. File size limit: 20 MB
5. Allowed MIME types: `model/gltf-binary, model/vnd.usdz+zip, application/octet-stream, image/jpeg, image/png, image/webp`

This bucket stores GLB, USDZ, and thumbnail assets for the AR menu preview feature.

## 4. Edge Functions

```bash
supabase functions deploy create-payment-order
supabase functions deploy verify-payment-webhook
```

`create-payment-order` is a safe placeholder until Razorpay credentials and provider API calls are added. `verify-payment-webhook` must verify Razorpay signatures before any payment or bill is marked paid.

## 5. Storage

Create a public `restaurant-assets` bucket for logos/menu photos. Keep writes authenticated and restaurant-folder scoped:

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
