create table if not exists "MarketingCampaign" (
  id text primary key default gen_random_uuid()::text,
  restaurant_id text not null references "Restaurant"(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('whatsapp', 'email', 'both')),
  subject text,
  message_body text not null,
  audience_filter jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  recipients_count integer,
  sent_count integer not null default 0,
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_campaign_restaurant_created_idx
  on "MarketingCampaign"(restaurant_id, created_at desc);

alter table if exists "MarketingCampaign" enable row level security;

drop policy if exists "campaigns_restaurant_access" on "MarketingCampaign";
create policy "campaigns_restaurant_access" on "MarketingCampaign"
  for all
  using (app_rls_staff_can_access("MarketingCampaign".restaurant_id))
  with check (app_rls_staff_can_access("MarketingCampaign".restaurant_id));
