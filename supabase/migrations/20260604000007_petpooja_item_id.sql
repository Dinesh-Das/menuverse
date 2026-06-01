-- Map Petpooja items and poll availability every 15 minutes.

alter table if exists "MenuItem"
  add column if not exists petpooja_item_id text;

create unique index if not exists menu_item_restaurant_petpooja_item_idx
  on "MenuItem"(restaurant_id, petpooja_item_id)
  where petpooja_item_id is not null;

create or replace function public.get_public_menu_by_slug(p_restaurant_slug text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with selected_restaurant as (
    select restaurant.*
    from "Restaurant" restaurant
    where p_restaurant_slug is null or restaurant.slug = p_restaurant_slug
    order by restaurant.created_at asc
    limit 1
  )
  select jsonb_build_object(
    'restaurant',
      to_jsonb(selected_restaurant)
      - 'pos_config'
      - 'pos_provider'
      - 'pos_sync_enabled'
      - 'printer_enabled'
      - 'whatsapp_enabled'
      - 'ranking_needs_recalc',
    'categories', coalesce((
      select jsonb_agg(
        to_jsonb(category) || jsonb_build_object(
          'items', coalesce((
            select jsonb_agg(
              (
                to_jsonb(menu_item)
                - 'pos_catalog_variation_id'
                - 'petpooja_item_id'
              ) || jsonb_build_object(
                'modifier_groups', coalesce((
                  select jsonb_agg(
                    to_jsonb(modifier_group) || jsonb_build_object(
                      'options', coalesce((
                        select jsonb_agg(to_jsonb(modifier_option) order by modifier_option.name)
                        from "ModifierOption" modifier_option
                        where modifier_option.group_id = modifier_group.id
                      ), '[]'::jsonb)
                    ) order by modifier_group.created_at, modifier_group.name
                  )
                  from "ModifierGroup" modifier_group
                  where modifier_group.menu_item_id = menu_item.id
                    and modifier_group.restaurant_id = selected_restaurant.id
                ), '[]'::jsonb)
              )
              order by coalesce(menu_item.dynamic_rank, menu_item.display_order), menu_item.display_order, menu_item.name
            )
            from "MenuItem" menu_item
            where menu_item.category_id = category.id
              and menu_item.restaurant_id = selected_restaurant.id
              and menu_item.available = true
          ), '[]'::jsonb)
        ) order by category.display_order, category.name
      )
      from "MenuCategory" category
      where category.restaurant_id = selected_restaurant.id
        and category.archived = false
    ), '[]'::jsonb)
  )
  from selected_restaurant;
$$;

create or replace function public.get_public_menu_item(p_menu_item_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select (
      to_jsonb(menu_item)
      - 'pos_catalog_variation_id'
      - 'petpooja_item_id'
    )
    || jsonb_build_object(
      'category', to_jsonb(category),
      'restaurant',
        to_jsonb(restaurant)
        - 'pos_config'
        - 'pos_provider'
        - 'pos_sync_enabled'
        - 'printer_enabled'
        - 'whatsapp_enabled'
        - 'ranking_needs_recalc',
      'modifier_groups', coalesce((
        select jsonb_agg(
          to_jsonb(modifier_group) || jsonb_build_object(
            'options', coalesce((
              select jsonb_agg(to_jsonb(modifier_option) order by modifier_option.name)
              from "ModifierOption" modifier_option
              where modifier_option.group_id = modifier_group.id
            ), '[]'::jsonb)
          ) order by modifier_group.created_at, modifier_group.name
        )
        from "ModifierGroup" modifier_group
        where modifier_group.menu_item_id = menu_item.id
          and modifier_group.restaurant_id = menu_item.restaurant_id
      ), '[]'::jsonb)
    )
  from "MenuItem" menu_item
  join "MenuCategory" category on category.id = menu_item.category_id
  join "Restaurant" restaurant on restaurant.id = menu_item.restaurant_id
  where menu_item.id = p_menu_item_id
    and category.archived = false
    and menu_item.available = true
  limit 1;
$$;

grant execute on function public.get_public_menu_by_slug(text) to anon, authenticated;
grant execute on function public.get_public_menu_item(text) to anon, authenticated;

create or replace function public.queue_petpooja_availability_sync_tick()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_internal_secret text;
  v_targets jsonb;
begin
  v_url := nullif(
    trim(trailing '/' from coalesce(
      nullif(current_setting('app.settings.edge_function_base_url', true), ''),
      nullif(current_setting('app.settings.supabase_url', true), ''),
      nullif(current_setting('app.supabase_url', true), '')
    )),
    ''
  );
  v_internal_secret := coalesce(
    nullif(current_setting('app.settings.menuverse_internal_secret', true), ''),
    nullif(current_setting('app.menuverse_internal_secret', true), '')
  );

  if v_url is null or v_internal_secret is null then
    return 0;
  end if;
  if position('/functions/v1' in v_url) = 0 then
    v_url := v_url || '/functions/v1';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('restaurant_id', id)), '[]'::jsonb)
    into v_targets
  from "Restaurant"
  where pos_sync_enabled = true
    and pos_provider = 'petpooja';

  if jsonb_array_length(v_targets) = 0 then
    return 0;
  end if;

  perform net.http_post(
    url := v_url || '/sync-petpooja-availability',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Menuverse-Internal-Secret', v_internal_secret
    ),
    body := v_targets,
    timeout_milliseconds := 5000
  );
  return jsonb_array_length(v_targets);
exception
  when invalid_schema_name or undefined_function then
    return 0;
end;
$$;

revoke all on function public.queue_petpooja_availability_sync_tick() from public;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('sync-petpooja-availability');
    exception
      when others then
        null;
    end;

    perform cron.schedule(
      'sync-petpooja-availability',
      '*/15 * * * *',
      'select public.queue_petpooja_availability_sync_tick();'
    );
  end if;
end $$;
