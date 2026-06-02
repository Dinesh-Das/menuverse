# Supabase Webhooks

## OrderFeedback sentiment analysis

Migration `20260603000000_production_hardening.sql` creates an `AFTER INSERT OR UPDATE` trigger on `public.OrderFeedback`. The trigger inserts into `SentimentQueue`, so feedback submission returns without waiting for sentiment analysis. A cron worker invokes `process-sentiment-queue` in batches and that function calls `analyse-feedback`.

Configure the Edge Function base URL and internal worker secret as protected database settings:

```sql
alter database postgres set "app.settings.supabase_url" = 'https://your-project.supabase.co';
alter database postgres set "app.settings.menuverse_internal_secret" = '<same-value-as-MENUVERSE_INTERNAL_SECRET>';
```

The URL trigger also accepts the legacy alias `app.supabase_url`. Database workers send `X-Menuverse-Internal-Secret`; the service-role key is never sent through `pg_net`.

The function receives this payload asynchronously:

```json
{ "feedback_id": "<OrderFeedback.id>" }
```

Do not configure a dashboard webhook directly to `analyse-feedback`. The queue worker owns retries and dead-letter alerting.

## AR source video processing

`ARStudio` invokes `process-ar-asset` immediately after uploading a source video. For dashboard-managed storage automation, add a Storage Webhook too:

- Bucket: `ar-source-videos`
- Event: `INSERT`
- Method: `POST`
- URL: `https://your-project.supabase.co/functions/v1/process-ar-asset`
- Headers: `Content-Type: application/json`, `X-Menuverse-Internal-Secret: <MENUVERSE_INTERNAL_SECRET>`
- Body: the default storage object payload

The function can resolve the asset from the storage path format:

```text
<restaurant_id>/<menu_item_id>/source-<uuid>.mp4
```

Set `REPLICATE_WEBHOOK_SECRET` as an Edge Function secret too. The queued AR worker includes it only in the server-to-server Replicate callback URL.

## WhatsApp inbound ordering

Point your Twilio, 360dialog, or Meta WhatsApp Business webhook to:

```text
https://your-project.supabase.co/functions/v1/whatsapp-inbound?restaurant_id=<restaurant_id>
```

For multi-restaurant phone numbers, configure `WHATSAPP_RESTAURANT_MAP` as a JSON object that maps the receiving WhatsApp number to a `Restaurant.id`.

## POS status callbacks

Configure Square or Petpooja callbacks under **Settings > Integrations**, then point the provider at:

```text
https://your-project.supabase.co/functions/v1/pos-status-webhook?restaurant_id=<id>&provider=square
https://your-project.supabase.co/functions/v1/pos-status-webhook?restaurant_id=<id>&provider=petpooja
```

Square uses `x-square-hmacsha256-signature`. Register `catalog.version.updated` in addition to order status events when Square availability sync is enabled. Petpooja and custom POS callbacks use `x-menuverse-signature`, the lowercase hex HMAC-SHA256 digest of the raw request body.

## Delivery aggregator callbacks

Swiggy, Zomato, Uber Eats, DoorDash, Google Food, and custom channel bridges post normalized orders to:

```text
https://your-project.supabase.co/functions/v1/aggregator-order-webhook?restaurant_id=<id>&channel=zomato
```

Use the per-channel signing secret configured under **Settings > Integrations**. Bridges may always send `x-menuverse-signature`; provider-specific aliases are also accepted:

| Channel | Accepted signature headers |
| --- | --- |
| Swiggy | `x-swiggy-signature`, `x-menuverse-signature` |
| Zomato | `x-zomato-signature`, `x-menuverse-signature` |
| Uber Eats | `x-uber-signature`, `x-menuverse-signature` |
| DoorDash | `x-doordash-signature`, `x-menuverse-signature` |
| Google Food | `x-google-signature`, `x-menuverse-signature` |
| Custom | `x-menuverse-signature` |

All signatures are lowercase hex HMAC-SHA256 digests of the raw request body. The canonical payload shape is:

```json
{
  "external_order_id": "provider-order-123",
  "items": [{ "menu_item_id": "menu-item-id", "quantity": 2 }],
  "customer": { "name": "Guest", "phone": "+919999999999" },
  "delivery_address": { "street": "1 Market Road", "city": "Delhi", "pincode": "110001" }
}
```

The webhook adapter also accepts common provider nesting such as `order.items`, `data.order.items`, `line_items`, `cart_items`, `orderId`, `merchant_item_id`, and `external_id`. Map partner catalog IDs to Menuverse `MenuItem.id` values in the provider bridge before delivery.

## POS bridge adapters

Square and Petpooja have first-party adapters. Toast, Lightspeed, Revel, and NCR Aloha use the signed bridge mode under **Settings > Integrations**:

1. Choose the named bridge provider.
2. Set the outbound bridge endpoint and shared signing secret.
3. Copy the generated inbound status callback into the bridge.
4. Post status callbacks with `x-menuverse-signature`, using lowercase hex HMAC-SHA256 over the raw JSON body.

Inbound callbacks accept `order_id`, `orderid`, or `pos_order_id`, plus `status`, `order_status`, or `state`.

## Meta social ordering callbacks

Instagram and Facebook structured-order callbacks use:

```text
https://your-project.supabase.co/functions/v1/meta-order-webhook?restaurant_id=<id>&channel=instagram
```

Configure the verify token and Meta app secret in **Settings > Integrations**. POST requests must include Meta's `x-hub-signature-256` HMAC header. Structured orders can be sent as a top-level `order` object or as JSON in a messaging postback payload.

## Social publishing bridges

For operator-authored Instagram and Facebook posts, configure a **Social publishing bridge endpoint** under **Settings > Integrations**. Menuverse sends:

```json
{
  "job_id": "<IntegrationJob.id>",
  "restaurant_id": "<id>",
  "channel": "instagram",
  "message": "Tonight's special",
  "image_url": "https://...",
  "ordering_link": "https://...",
  "requested_at": "2026-06-01T12:00:00.000Z"
}
```

The bridge endpoint must return an HTTP 2xx response. Menuverse treats any non-2xx response as a failed `IntegrationJob` and surfaces it under **Settings > Integrations**.

### Make or Zapier bridge

1. Create a webhook-triggered workflow and paste its URL into **Settings > Integrations > Social publishing bridge endpoint**.
2. Add an Instagram or Facebook publishing action.
3. Map `message`, `image_url`, and `ordering_link` from the webhook body.
4. Activate the workflow and publish a test campaign.

### Self-hosted bridge

Accept the JSON body above, publish through Meta's provider-specific flow, and return `{"ok": true}` with status `200`. Keep Meta page tokens on the bridge server rather than in browser code.

## Email delivery bridge

Campaign email uses Resend when `RESEND_API_KEY` is configured. To deliver through an SMTP relay or another provider, set `EMAIL_DELIVERY_WEBHOOK_URL` and optionally `EMAIL_DELIVERY_WEBHOOK_TOKEN`; Menuverse sends the rendered email payload to that server-side bridge.
