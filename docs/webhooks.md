# Supabase Webhooks

## OrderFeedback sentiment analysis

`submit_order_feedback_secure` now enqueues `analyse-feedback` with `pg_net` when the database has an Edge Function base URL configured:

```sql
alter database postgres set "app.settings.supabase_url" = 'https://your-project.supabase.co';
```

The function posts this payload asynchronously:

```json
{ "feedback_id": "<OrderFeedback.id>" }
```

If you prefer a dashboard-managed webhook, create a Database Webhook in Supabase:

- Table: `public.OrderFeedback`
- Event: `INSERT`
- Method: `POST`
- URL: `https://your-project.supabase.co/functions/v1/analyse-feedback`
- Headers: `Content-Type: application/json`
- Body:

```json
{ "feedback_id": "{{ record.id }}" }
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
