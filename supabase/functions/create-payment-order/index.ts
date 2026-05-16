import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Payment service is not configured.' }, { status: 503, headers: corsHeaders });
  }

  const body = await req.json().catch(() => ({}));
  const tableSessionToken = body.table_session_token;
  if (!tableSessionToken) {
    return Response.json({ error: 'table_session_token is required.' }, { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: orders, error } = await supabase.rpc('get_table_session_orders', {
    p_table_session_token: tableSessionToken,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 400, headers: corsHeaders });
  }

  const amount = Array.isArray(orders)
    ? orders.filter((order) => order.status !== 'cancelled').reduce((sum, order) => sum + Number(order.total_amount || 0), 0)
    : Number(body.amount || 0);

  // Replace this with Razorpay Orders API creation when credentials are configured.
  return Response.json({
    provider: 'razorpay',
    status: 'configuration_required',
    amount,
    currency: 'INR',
    message: 'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, then create the provider order server-side here.',
  }, { headers: corsHeaders });
});
