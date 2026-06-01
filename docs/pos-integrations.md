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

Manual token setup:

1. Create a Square app in the Square Developer Dashboard.
2. Generate a scoped access token with `ORDERS_WRITE`, `ITEMS_READ`, and `MERCHANT_PROFILE_READ`.
3. Save the token plus selected location ID in the Settings UI.
4. For sandbox testing, use `"square_environment": "sandbox"` and a sandbox access token/location.

Square's OAuth flow can replace manual tokens during hosted onboarding, but it requires your Square application ID, secret, redirect URL, and token-refresh deployment. See the [Square OAuth overview](https://developer.squareup.com/docs/oauth-api/overview).

The adapter creates a Square order through `POST /v2/orders`. Square's fulfillment enum does not define `DINE_IN`, so restaurant orders use `PICKUP` with the Menuverse order ID and table number in metadata and the fulfillment note.

Register this signed callback for order status and `catalog.version.updated` events:

```text
https://your-project.supabase.co/functions/v1/pos-status-webhook?restaurant_id=<restaurant-id>&provider=square
```

To synchronize sold-out state, enable **Sync mapped item availability from Square** and set each menu item's **Square Variation ID** in **Menu Assets**. Catalog webhooks and the manual sync button update Menuverse availability from Square variation location settings and sold-out overrides. See Square's [sold-out variation guide](https://developer.squareup.com/docs/inventory-api/monitor-sold-out-status-on-item-variation).

## Petpooja

Choose **Petpooja** in POS Settings and enter the API key, app key, restaurant ID, API endpoint, and inbound shared secret. Outbound orders are posted to `/api/v1/porders`. Status callbacks post to:

```text
https://your-project.supabase.co/functions/v1/pos-status-webhook?restaurant_id=<restaurant-id>&provider=petpooja
```

Sign custom/Petpooja callbacks with `x-menuverse-signature`, the lowercase hex HMAC-SHA256 digest of the raw request body.

## Custom POS webhook

Choose **Custom webhook** for a bridge service. Menuverse posts outbound orders to the configured endpoint and accepts signed status callbacks through `pos-status-webhook?provider=webhook`.

POS sync is controlled per restaurant by `Restaurant.pos_sync_enabled`. It is not blocked by a frontend enable flag. `VITE_DISABLE_POS_EDGE_SYNC=true` is an emergency-only kill switch for browser-triggered manual sync requests.
