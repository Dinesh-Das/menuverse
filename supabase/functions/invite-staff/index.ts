import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'https://menuverse.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function normalizeEmail(email: unknown) {
  return String(email || '').trim().toLowerCase();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Staff invite service is not configured.' }, 503);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Authentication is required.' }, 401);

  const body = await req.json().catch(() => ({}));
  const restaurantId = String(body.restaurant_id || '').trim();
  const email = normalizeEmail(body.email);
  const role = String(body.role || 'staff').trim();

  if (!restaurantId) return json({ error: 'restaurant_id is required.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'A valid email is required.' }, 400);
  if (!['manager', 'staff'].includes(role)) return json({ error: 'Role must be manager or staff.' }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: callerData, error: callerError } = await supabase.auth.getUser(jwt);
  if (callerError || !callerData.user) return json({ error: 'Invalid authentication token.' }, 401);

  const { data: ownerProfile, error: profileError } = await supabase
    .from('User')
    .select('id, restaurant_id, role')
    .eq('id', callerData.user.id)
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (profileError) return json({ error: profileError.message }, 500);
  if (!ownerProfile || ownerProfile.role !== 'owner') {
    return json({ error: 'Only the restaurant owner can invite team members.' }, 403);
  }

  const now = new Date().toISOString();
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('User')
    .select('id, restaurant_id, role')
    .eq('email', email)
    .maybeSingle();

  if (existingProfileError) return json({ error: existingProfileError.message }, 500);
  if (existingProfile && existingProfile.restaurant_id !== restaurantId) {
    await supabase.from('StaffInvite').insert({
      restaurant_id: restaurantId,
      email,
      role,
      status: 'failed',
      invited_by: callerData.user.id,
      error: 'Email already belongs to another restaurant.',
      created_at: now,
      updated_at: now,
    });
    return json({ error: 'That email already belongs to another restaurant.' }, 409);
  }

  if (existingProfile) {
    const { error: updateError } = await supabase
      .from('User')
      .update({ role, updated_at: now })
      .eq('id', existingProfile.id)
      .eq('restaurant_id', restaurantId);
    if (updateError) return json({ error: updateError.message }, 500);

    await supabase.from('StaffInvite').insert({
      restaurant_id: restaurantId,
      email,
      role,
      status: 'accepted',
      invited_by: callerData.user.id,
      invited_user_id: existingProfile.id,
      created_at: now,
      updated_at: now,
    });

    return json({ invited: false, linked_existing_user: true, user_id: existingProfile.id });
  }

  const redirectBase = Deno.env.get('APP_ORIGIN') || Deno.env.get('SITE_URL') || '';
  const inviteOptions = {
    data: { restaurantId, role },
    ...(redirectBase ? { redirectTo: `${redirectBase.replace(/\/$/, '')}/admin/login` } : {}),
  };

  const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, inviteOptions);
  if (inviteError || !inviteData.user) {
    await supabase.from('StaffInvite').insert({
      restaurant_id: restaurantId,
      email,
      role,
      status: 'failed',
      invited_by: callerData.user.id,
      error: inviteError?.message || 'Invite did not return a user.',
      created_at: now,
      updated_at: now,
    });
    return json({ error: inviteError?.message || 'Failed to send invite.' }, 502);
  }

  const { error: upsertError } = await supabase
    .from('User')
    .upsert({
      id: inviteData.user.id,
      restaurant_id: restaurantId,
      email,
      password_hash: 'supabase_auth_managed',
      role,
      created_at: now,
      updated_at: now,
    }, { onConflict: 'id' });

  if (upsertError) return json({ error: upsertError.message }, 500);

  const { error: inviteRecordError } = await supabase.from('StaffInvite').insert({
    restaurant_id: restaurantId,
    email,
    role,
    status: 'sent',
    invited_by: callerData.user.id,
    invited_user_id: inviteData.user.id,
    created_at: now,
    updated_at: now,
  });

  if (inviteRecordError) return json({ error: inviteRecordError.message }, 500);

  return json({ invited: true, user_id: inviteData.user.id });
});
