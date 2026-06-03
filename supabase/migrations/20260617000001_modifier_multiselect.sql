alter table if exists "ModifierGroup"
  add column if not exists selection_type text not null default 'single'
    check (selection_type in ('single', 'multi')),
  add column if not exists max_selections integer,
  add column if not exists min_selections integer not null default 0;
