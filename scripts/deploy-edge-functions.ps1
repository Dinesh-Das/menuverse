param(
  [string]$ProjectRef = "gdlsgscmrgtadqrwtwgg"
)

$ErrorActionPreference = "Stop"

$functions = @(
  "analyse-feedback",
  "create-payment-order",
  "create-stripe-payment-intent",
  "delivery-quote",
  "get-recommendations",
  "invite-staff",
  "pos-adapter-petpooja",
  "pos-adapter-square",
  "process-ar-asset",
  "request-kitchen-print",
  "send-campaign",
  "send-whatsapp-notification",
  "sync-to-pos",
  "verify-payment-webhook",
  "verify-stripe-webhook",
  "whatsapp-inbound"
)

supabase functions deploy @functions --project-ref $ProjectRef --no-verify-jwt --use-api
