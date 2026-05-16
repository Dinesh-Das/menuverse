export const INTEGRATION_READINESS = [
  {
    key: 'payments',
    label: 'Razorpay Payments',
    status: 'server_setup_required',
    icon: 'payments',
    description: 'Live settlement must run through Edge Functions with provider keys and webhook verification.',
  },
  {
    key: 'printer',
    label: 'Printer / KOT',
    status: 'planned',
    icon: 'print',
    description: 'Kitchen ticket printing should be triggered by a server-side worker or webhook endpoint.',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp Alerts',
    status: 'planned',
    icon: 'chat',
    description: 'Customer and staff notifications need provider credentials stored only as Edge Function secrets.',
  },
  {
    key: 'analytics',
    label: 'Owner Analytics',
    status: 'ready_for_rpc',
    icon: 'monitoring',
    description: 'Use restaurant-scoped SQL views for top dishes, revenue, order count, average order value, and prep time.',
  },
];

export async function requestKitchenPrint(_ticket) {
  throw new Error('Printer/KOT integration is not configured yet.');
}

export async function sendWhatsAppNotification(_message) {
  throw new Error('WhatsApp integration is not configured yet.');
}
