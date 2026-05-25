insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ar-models',
  'ar-models',
  true,
  20971520, -- 20MB
  array[
    'model/gltf-binary',
    'model/vnd.usdz+zip',
    'model/vnd.pixar.usd',
    'application/octet-stream',
    'application/zip',
    'application/x-zip-compressed',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do nothing;

create policy "ar_models_public_read" on storage.objects
  for select using (bucket_id = 'ar-models');

create policy "ar_models_admin_upload" on storage.objects
  for insert with check (
    bucket_id = 'ar-models'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = coalesce(
      auth.jwt()->>'restaurantId',
      auth.jwt()->'app_metadata'->>'restaurantId',
      auth.jwt()->'user_metadata'->>'restaurantId'
    )
  );

create policy "ar_models_admin_update" on storage.objects
  for update using (
    bucket_id = 'ar-models'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = coalesce(
      auth.jwt()->>'restaurantId',
      auth.jwt()->'app_metadata'->>'restaurantId',
      auth.jwt()->'user_metadata'->>'restaurantId'
    )
  )
  with check (
    bucket_id = 'ar-models'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = coalesce(
      auth.jwt()->>'restaurantId',
      auth.jwt()->'app_metadata'->>'restaurantId',
      auth.jwt()->'user_metadata'->>'restaurantId'
    )
  );

create policy "ar_models_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'ar-models'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = coalesce(
      auth.jwt()->>'restaurantId',
      auth.jwt()->'app_metadata'->>'restaurantId',
      auth.jwt()->'user_metadata'->>'restaurantId'
    )
  );
