# POS Integrations

## Square

Square support is implemented by `supabase/functions/pos-adapter-square`. Configure it under **Settings > Integrations > POS Settings**. Tokens are stored in the server-only `IntegrationSecret` table; `Restaurant.pos_config` is retained only as an empty legacy compatibility column.

```json
{
  "square_access_token": "EAAA...",
  "square_location_id": "LOCATION_ID",
  "square_environment": "production",
  "square_currency": "USD"
}
```

OAuth setup:

1. Create a Square app in the Square Developer Dashboard.
2. Add an OAuth redirect URL that points to your owner onboarding flow.
3. Request Orders API permissions, including order write access.
4. Exchange the authorization code for an access token and save the token plus selected location ID in the Settings UI.
5. For sandbox testing, use `"square_environment": "sandbox"` and a sandbox access token/location.

The adapter creates a Square order through `POST /v2/orders`, tags the order metadata with `fulfillment_type: DINE_IN`, and includes the table number in the pickup fulfillment note for restaurant workflows.

Register this signed status callback:

```text
https://your-project.supabase.co/functions/v1/pos-status-webhook?restaurant_id=<restaurant-id>&provider=square
```

## Petpooja

Choose **Petpooja** in POS Settings and enter the API key, app key, restaurant ID, API endpoint, and inbound shared secret. Outbound orders are posted to `/api/v1/porders`. Status callbacks post to:

```text
https://your-project.supabase.co/functions/v1/pos-status-webhook?restaurant_id=<restaurant-id>&provider=petpooja
```

Sign custom/Petpooja callbacks with `x-menuverse-signature`, the lowercase hex HMAC-SHA256 digest of the raw request body.

## Custom POS webhook

Choose **Custom webhook** for a bridge service. Menuverse posts outbound orders to the configured endpoint and accepts signed status callbacks through `pos-status-webhook?provider=webhook`.

POS sync is controlled per restaurant by `Restaurant.pos_sync_enabled`. It is not blocked by a frontend enable flag. `VITE_DISABLE_POS_EDGE_SYNC=true` is an emergency-only kill switch for browser-triggered manual sync requests.
