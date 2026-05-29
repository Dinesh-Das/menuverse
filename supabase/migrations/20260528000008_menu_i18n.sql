create table if not exists "MenuItemTranslation" (
  id text primary key default gen_random_uuid()::text,
  menu_item_id text not null references "MenuItem"(id) on delete cascade,
  locale text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(menu_item_id, locale)
);

create index if not exists menu_item_translation_item_idx
  on "MenuItemTranslation"(menu_item_id);

create index if not exists menu_item_translation_locale_idx
  on "MenuItemTranslation"(locale);
