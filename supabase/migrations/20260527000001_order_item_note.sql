alter table if exists "OrderItem"
  add column if not exists item_note text check (char_length(item_note) <= 200);
