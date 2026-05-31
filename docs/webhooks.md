# Supabase Webhooks

## OrderFeedback sentiment analysis

Migration `20260601000000_sentiment_webhook_trigger.sql` creates an `AFTER INSERT` trigger on `public.OrderFeedback`. The trigger enqueues `analyse-feedback` with `pg_net`, so feedback submission returns without waiting for sentiment analysis.

Configure the Edge Function base URL and service-role key as database settings:

```sql
alter database postgres set "app.settings.supabase_url" = 'https://your-project.supabase.co';
alter database postgres set "app.settings.service_role_key" = '<service-role-key>';
```

The trigger also accepts the legacy aliases `app.supabase_url` and `app.service_role_key`. The service-role key is sent only from Postgres to the Edge Function as a bearer token. Store it as a protected secret and never expose it through Vite or client-side code.

The function receives this payload asynchronously:

```json
{ "feedback_id": "<OrderFeedback.id>" }
```

If you prefer a dashboard-managed webhook, create a Database Webhook in Supabase:

- Table: `public.OrderFeedback`
- Event: `INSERT`
- Method: `POST`
- URL: `https://your-project.supabase.co/functions/v1/analyse-feedback`
- Headers:
  - `Content-Type: application/json`
  - `Authorization: Bearer <service-role-key>`
- Body:

```json
{ "feedback_id": "{{ record.id }}" }
```

Use either the SQL trigger or the dashboard-managed webhook, not both, to avoid duplicate analysis requests. If you use the dashboard webhook, drop the SQL trigger:

```sql
drop trigger if exists trg_sentiment_analysis on public."OrderFeedback";
```

## AR source video processing

`ARStudio` invokes `process-ar-asset` immediately after uploading a source video. For dashboard-managed storage automation, add a Storage Webhook too:

- Bucket: `ar-source-videos`
- Event: `INSERT`
- Method: `POST`
- URL: `https://your-project.supabase.co/functions/v1/process-ar-asset`
- Headers: `Content-Type: application/json`
- Body: the default storage object payload

The function can resolve the asset from the storage path format:

```text
<restaurant_id>/<menu_item_id>/source-<uuid>.mp4
```

## WhatsApp inbound ordering

Point your Twilio, 360dialog, or Meta WhatsApp Business webhook to:

```text
https://your-project.supabase.co/functions/v1/whatsapp-inbound?restaurant_id=<restaurant_id>
```

For multi-restaurant phone numbers, configure `WHATSAPP_RESTAURANT_MAP` as a JSON object that maps the receiving WhatsApp number to a `Restaurant.id`.
