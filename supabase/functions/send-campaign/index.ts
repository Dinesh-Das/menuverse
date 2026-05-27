import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://menuverse.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(name|restaurant_name)\}\}/g, (_, key) => values[key] || '');
}

async function isAuthorized(supabase: ReturnType<typeof createClient>, req: Request, restaurantId: string) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData.user) return false;

  const { data, error } = await supabase
    .from('User')
    .select('id')
    .eq('id', userData.user.id)
    .eq('restaurant_id', restaurantId)
    .in('role', ['owner', 'manager'])
    .maybeSingle();
  return !error && Boolean(data);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Campaign service is not configured.' }, 503);

  const body = await req.json().catch(() => ({}));
  const campaignId = String(body.campaign_id || '').trim();
  if (!campaignId) return json({ error: 'campaign_id is required.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: campaign, error: campaignError } = await supabase
    .from('MarketingCampaign')
    .select('*, restaurant:Restaurant(name)')
    .eq('id', campaignId)
    .maybeSingle();
  if (campaignError) return json({ error: campaignError.message }, 500);
  if (!campaign) return json({ error: 'Campaign not found.' }, 404);
  if (!(await isAuthorized(supabase, req, campaign.restaurant_id))) {
    return json({ error: 'Not authorized to send this campaign.' }, 403);
  }

  const filter = campaign.audience_filter || {};
  let audienceQuery = supabase
    .from('GuestProfile')
    .select('id, name, phone, email')
    .eq('restaurant_id', campaign.restaurant_id)
    .eq('marketing_consent', true)
    .limit(500);

  if (filter.min_visits) audienceQuery = audienceQuery.gte('visit_count', Number(filter.min_visits));
  if (filter.last_visit_days) {
    audienceQuery = audienceQuery.gte('last_visit_at', new Date(Date.now() - Number(filter.last_visit_days) * 86400000).toISOString());
  }

  const { data: recipients, error: recipientsError } = await audienceQuery;
  if (recipientsError) return json({ error: recipientsError.message }, 500);

  await supabase
    .from('MarketingCampaign')
    .update({
      status: 'sending',
      recipients_count: recipients?.length || 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  const sendgridKey = Deno.env.get('SENDGRID_API_KEY');
  const fromEmail = Deno.env.get('SENDGRID_FROM_EMAIL') || 'no-reply@menuverse.app';
  const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
  let sentCount = 0;

  for (const recipient of recipients || []) {
    const message = renderTemplate(campaign.message_body, {
      name: recipient.name || 'there',
      restaurant_name: campaign.restaurant?.name || 'our restaurant',
    });

    if ((campaign.channel === 'whatsapp' || campaign.channel === 'both') && recipient.phone) {
      const { data: whatsAppResult } = await supabase.functions.invoke('send-whatsapp-notification', {
        body: {
          restaurant_id: campaign.restaurant_id,
          phone: recipient.phone,
          message,
        },
        headers: internalSecret ? { 'X-Menuverse-Internal-Secret': internalSecret } : undefined,
      });
      if (whatsAppResult?.status === 'delivered' || whatsAppResult?.queued) sentCount += 1;
    }

    if ((campaign.channel === 'email' || campaign.channel === 'both') && recipient.email && sendgridKey) {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient.email }] }],
          from: { email: fromEmail, name: campaign.restaurant?.name || 'Menuverse' },
          subject: campaign.subject || campaign.name,
          content: [{ type: 'text/plain', value: message }],
        }),
      });
      if (response.ok) sentCount += 1;
    }

    await supabase
      .from('MarketingCampaign')
      .update({ sent_count: sentCount, updated_at: new Date().toISOString() })
      .eq('id', campaignId);
  }

  await supabase
    .from('MarketingCampaign')
    .update({
      status: 'sent',
      sent_count: sentCount,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  return json({ status: 'sent', sent_count: sentCount, recipients_count: recipients?.length || 0 });
});
