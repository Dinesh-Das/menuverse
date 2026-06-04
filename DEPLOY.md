# Menuverse Deployment Guide

Last updated: June 2026. Production architecture is Supabase-native.

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
VITE_ENABLE_SERVER_RECOMMENDATIONS=true
VITE_ENABLE_CLIENT_FEEDBACK_ANALYSIS=false
VITE_ENABLE_KOT_EDGE_PRINT=false
VITE_ENABLE_WHATSAPP_EDGE_NOTIFICATIONS=false
VITE_DISABLE_POS_EDGE_SYNC=false
VITE_ENABLE_AR_EDGE_PROCESSING=false
VITE_ENABLE_DELIVERY_QUOTE_EDGE=false
VITE_ENABLE_MENU_CHAT=false
```

Keep optional browser-triggered Edge Function flags `false` until the matching functions are deployed. POS is different: configured restaurants queue POS work at runtime from the database. Use `VITE_DISABLE_POS_EDGE_SYNC=true` only as an emergency kill switch. Returning guests use server recommendations even when the optional recommendation flag is off; production deployments should keep it enabled for anonymous upsells too.

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
SQUARE_ACCESS_TOKEN=server-only-fallback
SQUARE_LOCATION_ID=square-location-id
SQUARE_ENVIRONMENT=sandbox
SQUARE_VERSION=2026-05-20
SQUARE_APP_ID=square-application-id
SQUARE_APP_SECRET=server-only-square-application-secret
APP_URL=https://your-menuverse-domain.com
PETPOOJA_API_KEY=server-only-fallback
PETPOOJA_APP_KEY=server-only-fallback
PETPOOJA_RESTAURANT_ID=restaurant-id-fallback
PETPOOJA_WEBHOOK_URL=https://mapi.petpooja.com
SHIPROCKET_API_TOKEN=server-only
SHIPROCKET_PICKUP_POSTCODE=110030
WHATSAPP_VERIFY_TOKEN=shared-webhook-verify-token
WHATSAPP_DEFAULT_RESTAURANT_ID=restaurant-id-for-single-number
WHATSAPP_RESTAURANT_MAP={"919999999999":"restaurant-id"}
WHATSAPP_INBOUND_REPLY_WEBHOOK_URL=https://provider.example/send
REPLICATE_API_TOKEN=server-only
REPLICATE_WEBHOOK_SECRET=random-callback-secret
REPLICATE_MODEL=stability-ai/triposr
REPLICATE_MODEL_VERSION=
REPLICATE_CANCEL_AFTER=20m
AR_USDZ_CONVERTER_URL=
```

Never expose service role, payment secret, or webhook secret values to Vite.

## 3. Database

Run all SQL migrations under `supabase/migrations/`, then run:

```sql
-- Supabase SQL editor
\i supabase/rls-policies.sql
```

If using the dashboard SQL editor, paste the contents of `supabase/rls-policies.sql`.

### Required Supabase Extensions

Enable these in the hosted Supabase dashboard before running migrations:

- `pgcrypto` for UUID and crypto helpers.
- `pg_net` for database-triggered Edge Function calls.
- `pg_cron` for sentiment processing, ranking refreshes, POS retry, token refresh, WhatsApp expiry, and catalog sync workers.

Migrations attempt to create these extensions, but hosted Supabase projects can require a dashboard toggle under **Project Settings > Database > Extensions**. If `pg_cron` was enabled after migrations already ran, rerun the latest migrations or schedule the jobs manually:

```sql
select cron.schedule('retry-failed-integration-jobs', '*/2 * * * *', 'select public.retry_failed_integration_jobs();');
select cron.schedule('process-sentiment-queue', '* * * * *', 'select public.process_sentiment_queue_tick();');
select cron.schedule('recalculate-dirty-menu-rankings', '*/10 * * * *', 'select public.process_dirty_menu_rankings();');
select cron.schedule('queue-pending-pos-jobs', '* * * * *', 'select public.queue_pending_pos_jobs();');
select cron.schedule('expire-stale-whatsapp-sessions', '*/30 * * * *', $$
  update "WhatsAppSession"
  set state = 'expired',
      updated_at = now()
  where updated_at < now() - interval '2 hours'
    and state not in ('completed', 'expired');
$$);
select cron.schedule('process-ar-video-queue', '*/1 * * * *', $$
  select net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/process-ar-video',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Menuverse-Internal-Secret', current_setting('app.settings.menuverse_internal_secret')
    ),
    body := '{}'::jsonb
  );
$$);
select cron.schedule('integration-token-expiry-check', '0 9 * * *', 'select public.check_integration_token_expiry();');
select cron.schedule('refresh-square-oauth-tokens', '0 9 * * *', 'select public.queue_square_token_refresh_tick();');
select cron.schedule('sync-square-catalog-availability', '*/30 * * * *', 'select public.queue_square_catalog_sync_tick();');
select cron.schedule('refresh-menu-item-stats', '*/15 * * * *', 'select public.refresh_all_menu_item_stats();');
select cron.schedule('sync-petpooja-availability', '*/15 * * * *', 'select public.queue_petpooja_availability_sync_tick();');
select public.verify_required_cron_jobs();
```

## Post-Deployment Configuration

Complete these activation steps after migrations and Edge Function deployment:

1. Set the Supabase project URL for database workers:

```sql
alter database postgres set "app.settings.supabase_url" = 'https://<YOUR_PROJECT_REF>.supabase.co';
```

2. Set the internal worker secret to the same value as the `MENUVERSE_INTERNAL_SECRET` Edge Function secret:

```sql
alter database postgres set "app.settings.menuverse_internal_secret" = '<MENUVERSE_INTERNAL_SECRET>';
```

3. Add the Anthropic Edge Function secret for full NLP sentiment analysis:

```bash
supabase secrets set ANTHROPIC_API_KEY=<ANTHROPIC_API_KEY>
```

Do not store `SUPABASE_SERVICE_ROLE_KEY` in a Postgres app setting. The service-role key stays inside Supabase Edge Function secrets only. Database jobs authenticate to Edge Functions with `X-Menuverse-Internal-Secret`.

Set these Edge Function secrets:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=server-only-service-role-key
MENUVERSE_INTERNAL_SECRET=long-random-shared-secret
ANTHROPIC_API_KEY=server-only-anthropic-key
```

`ANTHROPIC_API_KEY` is required for full NLP sentiment analysis. When it is absent, sentiment processing falls back to the deterministic numeric-rating and keyword baseline and still marks menu rankings for batched recalculation.

Verify sentiment processing after deployment:

1. Submit feedback for a served test order.
2. Confirm `SentimentQueue.status` changes from `pending` to `processed`.
3. Confirm the `OrderFeedback.analysis_source` field is populated.
4. Inspect queued `pg_net` request headers and confirm they contain `X-Menuverse-Internal-Secret`, never `Authorization: Bearer <service-role-key>`.
5. Confirm Dashboard shows `Sentiment analysis not configured` if either protected database setting is intentionally removed during a staging check.
6. Confirm Dashboard **AI Operations** shows URL, secret, and pg_cron readiness plus the last-24-hour AI versus baseline distribution.

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
supabase functions deploy analyse-feedback
supabase functions deploy aggregator-order-webhook
supabase functions deploy campaign-event-webhook
supabase functions deploy create-payment-order
supabase functions deploy create-stripe-payment-intent
supabase functions deploy delivery-quote
supabase functions deploy get-recommendations
supabase functions deploy invite-staff
supabase functions deploy integration-settings
supabase functions deploy menu-chat
supabase functions deploy pos-adapter-petpooja
supabase functions deploy pos-adapter-square
supabase functions deploy pos-status-webhook
supabase functions deploy process-sentiment-queue
supabase functions deploy process-ar-asset
supabase functions deploy process-ar-video
supabase functions deploy publish-social-post
supabase functions deploy replicate-webhook
supabase functions deploy refresh-square-tokens
supabase functions deploy request-kitchen-print
supabase functions deploy send-campaign
supabase functions deploy send-whatsapp-notification
supabase functions deploy sync-to-pos
supabase functions deploy sync-menu-to-channel
supabase functions deploy sync-pos-catalog
supabase functions deploy sync-petpooja-availability
supabase functions deploy square-oauth-start
supabase functions deploy square-oauth-callback
supabase functions deploy translate-menu-item
supabase functions deploy verify-payment-webhook
supabase functions deploy verify-stripe-webhook
supabase functions deploy whatsapp-inbound
supabase functions deploy meta-order-webhook
```

For browser-called functions, deploy with JWT verification disabled so `OPTIONS` preflight reaches the handler:

```bash
supabase functions deploy analyse-feedback get-recommendations request-kitchen-print --project-ref gdlsgscmrgtadqrwtwgg --no-verify-jwt --use-api
```

If the browser reports `Requested function was not found`, the function has not been deployed to that Supabase project yet.

`create-payment-order` creates Razorpay Orders with server-side credentials. `verify-payment-webhook` verifies Razorpay signatures before any payment or bill is marked paid.

`analyse-feedback` uses `ANTHROPIC_API_KEY` when configured and falls back to a deterministic rating/keyword baseline when it is not. `process-sentiment-queue` retries analysis in batches. `request-kitchen-print`, `send-whatsapp-notification`, and `sync-to-pos` queue integration jobs and forward to provider webhooks when those URLs are configured.

## Payment Provider Capabilities

| Provider | Capabilities |
| --- | --- |
| Razorpay | UPI, cards, netbanking, and supported wallets inside Razorpay Checkout. It does not promise a browser-native Apple Pay sheet. |
| Stripe | Cards plus browser-native Apple Pay and Google Pay through Payment Request when the browser, device, domain, and Stripe account are eligible. |

Choose Stripe in Settings when native Apple Pay is required.

For Stripe Apple Pay, register every live customer-ordering domain in Stripe before launch, including restaurant custom domains. Re-test the wallet button on Safari after DNS and HTTPS are live.

## Runtime Integrations

Owners configure POS, WhatsApp, delivery aggregators, Instagram, Facebook, Google ordering links, and signed custom webhooks under **Settings > Integrations**. Secret values are stored in `IntegrationSecret`, which has no browser-facing RLS policy. The browser receives redacted key names only.

Square and Petpooja use first-party POS adapters. Square OAuth automatically registers the generated inbound status callback URL and stores the returned signing key for webhook verification. If OAuth registration fails, use **Settings > Integrations > POS Settings** to copy the same URL into Square Developer Console > Webhooks > Add Endpoint. Petpooja still requires pasting the callback URL into the Petpooja POS portal. Custom POS providers use the signed webhook bridge: provide an outbound bridge endpoint, then copy the generated inbound status callback URL into the bridge configuration.

The integration endpoints are:

```text
POST /functions/v1/pos-status-webhook?restaurant_id=<id>&provider=square
POST /functions/v1/pos-status-webhook?restaurant_id=<id>&provider=petpooja
POST /functions/v1/aggregator-order-webhook?restaurant_id=<id>&channel=zomato
POST /functions/v1/meta-order-webhook?restaurant_id=<id>&channel=instagram
POST /functions/v1/sync-menu-to-channel
```

`aggregator-order-webhook` supports `swiggy`, `zomato`, `ubereats`, `doordash`, `google_food`, and `custom` normalized signed payloads. Failed deliveries and rejected callbacks create `IntegrationJob` or `AdminAlert` records visible to operators.

Square OAuth requires `SQUARE_APP_ID`, `SQUARE_APP_SECRET`, and `APP_URL`. Add this redirect URL in the Square developer dashboard:

```text
https://your-project.supabase.co/functions/v1/square-oauth-callback
```

Scheduled Square token refresh, Square catalog polling, and Petpooja availability polling also require the protected database settings under **Post-Deployment Configuration**.

## Troubleshooting

- `Sentiment analysis not configured`: set the two protected database settings in **Post-Deployment Configuration**.
- Failed `IntegrationJob`: open **Settings > Integrations** to inspect and retry delivery.
- Failed kitchen print: KDS shows a realtime warning with retry buttons.
- `SentimentQueue.dead_letter`: inspect `last_error`, restore Edge Function secrets, then requeue the record after fixing the cause.

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

## Remaining Deployment Choice

Restaurants that need stricter bill privacy can disable open table-session joining and issue a fresh table QR at service start. The secure order RPC remains the only customer order creation path.
