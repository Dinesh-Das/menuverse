do $$ begin
  create type table_surface as enum ('table', 'counter', 'parking', 'delivery_zone', 'room', 'other');
exception when duplicate_object then null;
end $$;

alter table if exists "Table"
  add column if not exists surface_type table_surface not null default 'table',
  add column if not exists surface_label text;
