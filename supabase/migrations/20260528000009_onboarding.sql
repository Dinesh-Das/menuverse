alter table if exists "Restaurant"
  add column if not exists onboarding_complete boolean not null default false,
  add column if not exists onboarding_step integer not null default 0,
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists gstin text;

create or replace function seed_sample_menu(p_restaurant_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat_id text;
begin
  if not app_admin_can_access(p_restaurant_id) then
    raise exception 'Not authorized.';
  end if;

  if exists (
    select 1
    from "MenuItem"
    where restaurant_id = p_restaurant_id
      and name in ('Paneer Tikka', 'Veg Spring Roll', 'Dal Makhani', 'Butter Chicken', 'Gulab Jamun', 'Mango Kulfi')
  ) then
    return;
  end if;

  insert into "MenuCategory" (id, restaurant_id, name, display_order, created_at, updated_at)
  values (gen_random_uuid()::text, p_restaurant_id, 'Starters', 1, now(), now())
  returning id into v_cat_id;

  insert into "MenuItem" (id, restaurant_id, category_id, name, price, available, display_order, created_at, updated_at)
  values
    (gen_random_uuid()::text, p_restaurant_id, v_cat_id, 'Paneer Tikka', 249, true, 1, now(), now()),
    (gen_random_uuid()::text, p_restaurant_id, v_cat_id, 'Veg Spring Roll', 149, true, 2, now(), now());

  insert into "MenuCategory" (id, restaurant_id, name, display_order, created_at, updated_at)
  values (gen_random_uuid()::text, p_restaurant_id, 'Mains', 2, now(), now())
  returning id into v_cat_id;

  insert into "MenuItem" (id, restaurant_id, category_id, name, price, available, display_order, created_at, updated_at)
  values
    (gen_random_uuid()::text, p_restaurant_id, v_cat_id, 'Dal Makhani', 199, true, 1, now(), now()),
    (gen_random_uuid()::text, p_restaurant_id, v_cat_id, 'Butter Chicken', 299, true, 2, now(), now());

  insert into "MenuCategory" (id, restaurant_id, name, display_order, created_at, updated_at)
  values (gen_random_uuid()::text, p_restaurant_id, 'Desserts', 3, now(), now())
  returning id into v_cat_id;

  insert into "MenuItem" (id, restaurant_id, category_id, name, price, available, display_order, created_at, updated_at)
  values
    (gen_random_uuid()::text, p_restaurant_id, v_cat_id, 'Gulab Jamun', 99, true, 1, now(), now()),
    (gen_random_uuid()::text, p_restaurant_id, v_cat_id, 'Mango Kulfi', 129, true, 2, now(), now());
end;
$$;

grant execute on function seed_sample_menu(text) to authenticated;
