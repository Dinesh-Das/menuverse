param(
  [string]$ProjectRef = "gdlsgscmrgtadqrwtwgg"
)

$ErrorActionPreference = "Stop"

$functions = @(
  "analyse-feedback",
  "aggregator-order-webhook",
  "campaign-event-webhook",
  "create-payment-order",
  "create-stripe-payment-intent",
  "delivery-quote",
  "get-recommendations",
  "invite-staff",
  "integration-settings",
  "menu-chat",
  "pos-adapter-petpooja",
  "pos-adapter-square",
  "pos-status-webhook",
  "process-sentiment-queue",
  "process-ar-asset",
  "process-ar-video",
  "publish-social-post",
  "replicate-webhook",
  "refresh-square-tokens",
  "request-kitchen-print",
  "send-campaign",
  "send-whatsapp-notification",
  "sync-to-pos",
  "sync-menu-to-channel",
  "sync-pos-catalog",
  "sync-petpooja-availability",
  "square-oauth-start",
  "square-oauth-callback",
  "translate-menu-item",
  "verify-payment-webhook",
  "verify-stripe-webhook",
  "whatsapp-inbound",
  "meta-order-webhook"
)

supabase functions deploy @functions --project-ref $ProjectRef --no-verify-jwt --use-api
