alter table if exists "ARAsset" enable row level security;

drop policy if exists "arasset_public_active_select" on "ARAsset";
drop policy if exists "arasset_admin_select" on "ARAsset";
drop policy if exists "arasset_admin_insert" on "ARAsset";
drop policy if exists "arasset_admin_update" on "ARAsset";
drop policy if exists "arasset_admin_delete" on "ARAsset";

create policy "arasset_public_active_select" on "ARAsset"
  for select
  using (
    is_active = true
    and exists (
      select 1
      from "MenuItem" mi
      where mi.id = "ARAsset".menu_item_id
        and mi.restaurant_id = "ARAsset".restaurant_id
        and mi.has_ar_preview = true
        and mi.ar_preview_enabled = true
    )
  );

create policy "arasset_admin_select" on "ARAsset"
  for select
  using (app_rls_staff_can_access("ARAsset".restaurant_id));

create policy "arasset_admin_insert" on "ARAsset"
  for insert
  with check (app_rls_staff_can_access("ARAsset".restaurant_id));

create policy "arasset_admin_update" on "ARAsset"
  for update
  using (app_rls_staff_can_access("ARAsset".restaurant_id))
  with check (app_rls_staff_can_access("ARAsset".restaurant_id));

create policy "arasset_admin_delete" on "ARAsset"
  for delete
  using (app_rls_staff_can_access("ARAsset".restaurant_id));

create or replace function get_public_ar_asset(p_menu_item_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'menu_item_id', mi.id,
    'has_ar_preview', mi.has_ar_preview,
    'model_glb_url', aa.model_glb_url,
    'model_usdz_url', aa.model_usdz_url,
    'thumbnail_url', aa.thumbnail_url,
    'fallback_video_url', aa.source_video_url
  )
  from "MenuItem" mi
  join "ARAsset" aa on aa.menu_item_id = mi.id
    and aa.restaurant_id = mi.restaurant_id
  join "MenuCategory" c on c.id = mi.category_id
  where mi.id = p_menu_item_id
    and mi.available = true
    and mi.has_ar_preview = true
    and mi.ar_preview_enabled = true
    and aa.is_active = true
    and c.archived = false
  limit 1;
$$;

grant execute on function get_public_ar_asset(text) to anon, authenticated;
