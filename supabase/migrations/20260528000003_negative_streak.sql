alter table if exists "MenuItem"
  add column if not exists negative_streak integer not null default 0,
  add column if not exists last_negative_alert_at timestamptz;
