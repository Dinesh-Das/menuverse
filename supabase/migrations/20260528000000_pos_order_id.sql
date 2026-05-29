alter table if exists "Order"
  add column if not exists pos_order_id text;

create index if not exists order_pos_order_id_idx
  on "Order"(pos_order_id)
  where pos_order_id is not null;
