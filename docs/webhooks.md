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

Square uses `x-square-hmacsha256-signature`. Petpooja and custom POS callbacks use `x-menuverse-signature`, the lowercase hex HMAC-SHA256 digest of the raw request body.

## Delivery aggregator callbacks

Swiggy, Zomato, Uber Eats, DoorDash, Google Food, and custom channel bridges post normalized orders to:

```text
https://your-project.supabase.co/functions/v1/aggregator-order-webhook?restaurant_id=<id>&channel=zomato
```

Use `x-menuverse-signature` with the per-channel signing secret. Payload shape:

```json
{
  "external_order_id": "provider-order-123",
  "items": [{ "menu_item_id": "menu-item-id", "quantity": 2 }],
  "customer": { "name": "Guest", "phone": "+919999999999" },
  "delivery_address": { "street": "1 Market Road", "city": "Delhi", "pincode": "110001" }
}
```

## Meta social ordering callbacks

Instagram and Facebook structured-order callbacks use:

```text
https://your-project.supabase.co/functions/v1/meta-order-webhook?restaurant_id=<id>&channel=instagram
```

Configure the verify token and Meta app secret in **Settings > Integrations**. POST requests must include Meta's `x-hub-signature-256` HMAC header. Structured orders can be sent as a top-level `order` object or as JSON in a messaging postback payload.
