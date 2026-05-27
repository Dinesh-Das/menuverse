alter table if exists "Restaurant"
  add column if not exists currency text not null default 'inr';

alter table if exists "Payment"
  add column if not exists stripe_payment_intent_id text;

create index if not exists payment_stripe_intent_idx
  on "Payment"(stripe_payment_intent_id);
