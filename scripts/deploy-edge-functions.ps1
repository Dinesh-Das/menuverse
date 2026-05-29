param(
  [string]$ProjectRef = "gdlsgscmrgtadqrwtwgg"
)

$ErrorActionPreference = "Stop"

$functions = @(
  "analyse-feedback",
  "campaign-event-webhook",
  "create-payment-order",
  "create-stripe-payment-intent",
  "delivery-quote",
  "get-recommendations",
  "invite-staff",
  "menu-chat",
  "pos-adapter-petpooja",
  "pos-adapter-square",
  "process-ar-asset",
  "process-ar-video",
  "replicate-webhook",
  "request-kitchen-print",
  "send-campaign",
  "send-whatsapp-notification",
  "sync-to-pos",
  "translate-menu-item",
  "verify-payment-webhook",
  "verify-stripe-webhook",
  "whatsapp-inbound"
)

supabase functions deploy @functions --project-ref $ProjectRef --no-verify-jwt --use-api
