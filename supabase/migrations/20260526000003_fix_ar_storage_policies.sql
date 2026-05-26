create or replace function public.app_storage_staff_can_access(p_restaurant_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.role() = 'service_role'
    or (
      auth.role() = 'authenticated'
      and (
        (
          coalesce(
            auth.jwt()->>'restaurantId',
            auth.jwt()->'app_metadata'->>'restaurantId',
            auth.jwt()->'user_metadata'->>'restaurantId'
          ) = p_restaurant_id
          and coalesce(
            auth.jwt()->>'role',
            auth.jwt()->'app_metadata'->>'role',
            auth.jwt()->'user_metadata'->>'role'
          ) in ('owner', 'manager', 'staff')
        )
        or exists (
          select 1
          from "User" u
          where u.id = auth.uid()::text
            and u.restaurant_id = p_restaurant_id
            and u.role in ('owner', 'manager', 'staff')
        )
        or exists (
          select 1
          from "User" u
          where u.email = auth.jwt()->>'email'
            and u.restaurant_id = p_restaurant_id
            and u.role in ('owner', 'manager', 'staff')
        )
      )
    );
$$;

drop policy if exists "ar_models_public_read" on storage.objects;
drop policy if exists "ar_models_admin_upload" on storage.objects;
drop policy if exists "ar_models_admin_update" on storage.objects;
drop policy if exists "ar_models_admin_delete" on storage.objects;

create policy "ar_models_public_read" on storage.objects
  for select using (bucket_id = 'ar-models');

create policy "ar_models_admin_upload" on storage.objects
  for insert with check (
    bucket_id = 'ar-models'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );

create policy "ar_models_admin_update" on storage.objects
  for update using (
    bucket_id = 'ar-models'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  )
  with check (
    bucket_id = 'ar-models'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );

create policy "ar_models_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'ar-models'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );
