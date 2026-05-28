# POS Integrations

## Square

Square support is implemented by `supabase/functions/pos-adapter-square`. Set `Restaurant.pos_provider` to `square` and store the OAuth result in `Restaurant.pos_config`:

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
4. Exchange the authorization code for an access token and save the token plus selected location ID in `Restaurant.pos_config`.
5. For sandbox testing, use `"square_environment": "sandbox"` and a sandbox access token/location.

The adapter creates a Square order through `POST /v2/orders`, tags the order metadata with `fulfillment_type: DINE_IN`, and includes the table number in the pickup fulfillment note for restaurant workflows.
