import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(name|first_name|restaurant_name)\}\}/g, (_, key) => values[key] || '');
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function addUtmToLinks(content: string, campaignId: string) {
  return content.replace(/https?:\/\/[^\s<>"')]+/g, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      url.searchParams.set('utm_source', 'menuverse');
      url.searchParams.set('utm_campaign', campaignId);
      return url.toString();
    } catch {
      return rawUrl;
    }
  });
}

function emailHtmlFromText(text: string) {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<>"')]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>');
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
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status);
  if (req.method === 'OPTIONS') return preflightResponse(req);
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

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const emailWebhookUrl = Deno.env.get('EMAIL_DELIVERY_WEBHOOK_URL');
  const emailWebhookToken = Deno.env.get('EMAIL_DELIVERY_WEBHOOK_TOKEN');
  const fromEmail = campaign.from_email || Deno.env.get('RESEND_FROM_EMAIL') || 'Menuverse <no-reply@menuverse.app>';
  const internalSecret = Deno.env.get('MENUVERSE_INTERNAL_SECRET');
  let sentCount = 0;
  let failedCount = 0;

  if ((campaign.channel === 'email' || campaign.channel === 'both') && !resendKey && !emailWebhookUrl) {
    return json({ error: 'Email delivery not configured. Set RESEND_API_KEY or EMAIL_DELIVERY_WEBHOOK_URL.' }, 503);
  }

  for (const recipient of recipients || []) {
    const firstName = String(recipient.name || '').trim().split(/\s+/)[0] || 'there';
    const template = campaign.message_template || campaign.message_body || '';
    const message = addUtmToLinks(renderTemplate(template, {
      name: recipient.name || firstName,
      first_name: firstName,
      restaurant_name: campaign.restaurant?.name || 'our restaurant',
    }), campaignId);

    if ((campaign.channel === 'whatsapp' || campaign.channel === 'both') && recipient.phone) {
      const { data: whatsAppResult, error: whatsAppError } = await supabase.functions.invoke('send-whatsapp-notification', {
        body: {
          restaurant_id: campaign.restaurant_id,
          phone: recipient.phone,
          message,
        },
        headers: internalSecret ? { 'X-Menuverse-Internal-Secret': internalSecret } : undefined,
      });
      const whatsAppSent = !whatsAppError && (whatsAppResult?.status === 'delivered' || whatsAppResult?.queued);
      if (whatsAppSent) sentCount += 1;
      else failedCount += 1;
      await supabase.from('CampaignSend').insert({
        campaign_id: campaignId,
        guest_profile_id: recipient.id,
        channel: 'whatsapp',
        external_id: whatsAppResult?.job_id || null,
        status: whatsAppSent ? (whatsAppResult?.status === 'delivered' ? 'delivered' : 'sent') : 'failed',
      });
    }

    if (campaign.channel === 'email' || campaign.channel === 'both') {
      if (!recipient.email) {
        failedCount += 1;
        await supabase.from('CampaignSend').insert({
          campaign_id: campaignId,
          guest_profile_id: recipient.id,
          channel: 'email',
          status: 'failed',
        });
      } else {
        const emailPayload = {
          from: fromEmail,
          to: [recipient.email],
          subject: renderTemplate(campaign.subject || campaign.name, {
            name: recipient.name || '',
            first_name: firstName,
            restaurant_name: campaign.restaurant?.name || 'our restaurant',
          }),
          text: message,
          html: `<html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px">
            ${emailHtmlFromText(message)}
            <hr style="margin-top:32px;border:none;border-top:1px solid #eee">
            <p style="font-size:12px;color:#999;margin-top:12px">
              You received this because you opted in at ${escapeHtml(campaign.restaurant?.name || 'our restaurant')}.
              <a href="#">Unsubscribe</a>
            </p>
          </body></html>`,
          tags: [
            { name: 'campaign_id', value: campaignId },
            { name: 'source', value: 'menuverse' },
          ],
        };
        const response = await fetch(resendKey ? 'https://api.resend.com/emails' : emailWebhookUrl!, {
          method: 'POST',
          headers: {
            ...(resendKey
              ? { Authorization: `Bearer ${resendKey}` }
              : emailWebhookToken
                ? { Authorization: `Bearer ${emailWebhookToken}` }
                : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailPayload),
        });
        if (response.ok) {
          sentCount += 1;
          const responseJson = await response.json().catch(() => ({}));
          await supabase.from('CampaignSend').insert({
            campaign_id: campaignId,
            guest_profile_id: recipient.id,
            channel: 'email',
            external_id: responseJson.id || null,
            status: 'sent',
          });
        } else {
          failedCount += 1;
          await supabase.from('CampaignSend').insert({
            campaign_id: campaignId,
            guest_profile_id: recipient.id,
            channel: 'email',
            status: 'failed',
          });
        }
      }
    }

    await supabase
      .from('MarketingCampaign')
      .update({ sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString() })
      .eq('id', campaignId);
  }

  const finalStatus = sentCount > 0 ? 'sent' : 'failed';
  await supabase
    .from('MarketingCampaign')
    .update({
      status: finalStatus,
      sent_count: sentCount,
      failed_count: failedCount,
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  return json({ status: finalStatus, sent_count: sentCount, failed_count: failedCount, recipients_count: recipients?.length || 0 });
});
