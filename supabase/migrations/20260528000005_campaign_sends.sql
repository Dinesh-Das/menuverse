create table if not exists "CampaignSend" (
  id text primary key default gen_random_uuid()::text,
  campaign_id text not null references "MarketingCampaign"(id) on delete cascade,
  guest_profile_id text references "GuestProfile"(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp')),
  external_id text,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'opened', 'clicked', 'failed', 'bounced')),
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  clicked_at timestamptz
);

create index if not exists campaign_send_campaign_idx on "CampaignSend"(campaign_id);
