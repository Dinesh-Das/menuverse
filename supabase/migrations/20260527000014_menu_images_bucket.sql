insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "menu_images_public_read" on storage.objects;
drop policy if exists "menu_images_staff_upload" on storage.objects;
drop policy if exists "menu_images_staff_update" on storage.objects;
drop policy if exists "menu_images_staff_delete" on storage.objects;

create policy "menu_images_public_read" on storage.objects
  for select using (bucket_id = 'menu-images');

create policy "menu_images_staff_upload" on storage.objects
  for insert with check (
    bucket_id = 'menu-images'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );

create policy "menu_images_staff_update" on storage.objects
  for update using (
    bucket_id = 'menu-images'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  ) with check (
    bucket_id = 'menu-images'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );

create policy "menu_images_staff_delete" on storage.objects
  for delete using (
    bucket_id = 'menu-images'
    and app_storage_staff_can_access((storage.foldername(name))[1])
  );
