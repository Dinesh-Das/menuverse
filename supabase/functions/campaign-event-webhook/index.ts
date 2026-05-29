import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Campaign webhook is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const eventType = String(body.type || '');
  const emailId = String(body.data?.email_id || body.data?.id || '');
  if (!emailId) return json({ ok: true });

  const statusMap: Record<string, string> = {
    'email.delivered': 'delivered',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
    'email.bounced': 'bounced',
    'email.spam_complaint': 'failed',
  };
  const newStatus = statusMap[eventType];
  if (!newStatus) return json({ ok: true });

  const patch: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'opened') patch.opened_at = new Date().toISOString();
  if (newStatus === 'clicked') patch.clicked_at = new Date().toISOString();

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  await supabase
    .from('CampaignSend')
    .update(patch)
    .eq('external_id', emailId);

  return json({ ok: true });
});
