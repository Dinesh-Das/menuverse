alter table if exists "Payment" drop constraint if exists "Payment_order_id_key";

alter table if exists "Payment"
  add column if not exists session_bill_id text references "SessionBill"(id),
  add column if not exists split_index integer not null default 0,
  add column if not exists split_total integer not null default 1;

alter table if exists "SessionBill"
  add column if not exists split_count integer not null default 1,
  add column if not exists split_paid integer not null default 0,
  add column if not exists split_status text not null default 'full'
    check (split_status in ('full', 'splitting', 'partially_paid', 'fully_split_paid'));

create unique index if not exists payment_order_split_unique
  on "Payment"(order_id, split_index);
