alter table if exists "GuestProfile"
  add column if not exists preferred_tags jsonb not null default '[]'::jsonb,
  add column if not exists disliked_tags jsonb not null default '[]'::jsonb,
  add column if not exists dietary_preference text;

drop function if exists get_guest_profile_for_session(text);
create or replace function get_guest_profile_for_session(p_session_token text)
returns table(
  id text,
  loyalty_points integer,
  loyalty_tier loyalty_tier,
  name text,
  phone text,
  email text,
  preferred_tags jsonb,
  disliked_tags jsonb,
  dietary_preference text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gp.id,
    gp.loyalty_points,
    gp.loyalty_tier,
    gp.name,
    gp.phone,
    gp.email,
    gp.preferred_tags,
    gp.disliked_tags,
    gp.dietary_preference
  from "TableSession" ts
  join "GuestProfile" gp on gp.id = ts.guest_profile_id
  where ts.token = p_session_token
    and ts.status in ('active', 'billing')
  limit 1;
$$;

grant execute on function get_guest_profile_for_session(text) to anon, authenticated;
