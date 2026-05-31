import { supabase } from './supabase';

function viteFlag(name) {
  return String(import.meta.env?.[name] || '').toLowerCase() === 'true';
}

const ENABLE_KOT_EDGE_PRINT = viteFlag('VITE_ENABLE_KOT_EDGE_PRINT');
const ENABLE_WHATSAPP_EDGE_NOTIFICATIONS = viteFlag('VITE_ENABLE_WHATSAPP_EDGE_NOTIFICATIONS');
const DISABLE_POS_EDGE_SYNC = viteFlag('VITE_DISABLE_POS_EDGE_SYNC');

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
    status: 'runtime_configured',
    icon: 'sync_alt',
    description: 'Configured restaurants queue orders automatically and signed POS callbacks update live order status.',
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
  if (!ENABLE_KOT_EDGE_PRINT) {
    return { queued: false, status: 'disabled' };
  }

  const { data, error } = await supabase.functions.invoke('request-kitchen-print', {
    body: ticket,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function sendWhatsAppNotification(message) {
  if (!ENABLE_WHATSAPP_EDGE_NOTIFICATIONS) {
    return { queued: false, status: 'disabled' };
  }

  const { data, error } = await supabase.functions.invoke('send-whatsapp-notification', {
    body: message,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function syncOrderToPos(payload) {
  if (DISABLE_POS_EDGE_SYNC) {
    return { queued: false, status: 'emergency_kill_switch' };
  }

  const { data, error } = await supabase.functions.invoke('sync-to-pos', {
    body: payload,
  });
  if (error) throw new Error(error.message);
  return data;
}
