import { supabase } from './supabase';

export const INTEGRATION_READINESS = [
  {
    key: 'payments',
    label: 'Razorpay Payments',
    status: 'checkout_ready',
    icon: 'payments',
    description: 'Checkout runs through Edge Functions, Razorpay Orders API, and signed webhook capture.',
  },
  {
    key: 'sentiment',
    label: 'AI Sentiment',
    status: 'edge_ready',
    icon: 'psychology',
    description: 'Feedback analysis runs through an Edge Function with Anthropic support and a local baseline fallback.',
  },
  {
    key: 'pos',
    label: 'POS Sync',
    status: 'webhook_boundary_ready',
    icon: 'sync_alt',
    description: 'Orders can be queued to a provider webhook without coupling POS adapters to the core order flow.',
  },
  {
    key: 'printer',
    label: 'Printer / KOT',
    status: 'webhook_boundary_ready',
    icon: 'print',
    description: 'KDS can queue KOT tickets through a server-side print webhook with job tracking.',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp Alerts',
    status: 'webhook_boundary_ready',
    icon: 'chat',
    description: 'Notification requests are routed through an Edge Function and provider credentials stay server-side.',
  },
  {
    key: 'analytics',
    label: 'Owner Analytics',
    status: 'ready_for_rpc',
    icon: 'monitoring',
    description: 'Use restaurant-scoped SQL views for top dishes, revenue, order count, average order value, and prep time.',
  },
];

export async function requestKitchenPrint(ticket) {
  const { data, error } = await supabase.functions.invoke('request-kitchen-print', {
    body: ticket,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function sendWhatsAppNotification(message) {
  const { data, error } = await supabase.functions.invoke('send-whatsapp-notification', {
    body: message,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function syncOrderToPos(payload) {
  const { data, error } = await supabase.functions.invoke('sync-to-pos', {
    body: payload,
  });
  if (error) throw new Error(error.message);
  return data;
}
