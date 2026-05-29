alter table if exists "Restaurant"
  add column if not exists qr_fg_color text not null default '#1a1a1a',
  add column if not exists qr_bg_color text not null default '#ffffff',
  add column if not exists qr_eye_color text not null default '#1a1a1a';
