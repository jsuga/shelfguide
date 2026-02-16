-- Cover cache fields for Supabase Storage-backed covers

alter table public.books
  add column if not exists cover_storage_path text,
  add column if not exists cover_cached_at timestamptz,
  add column if not exists cover_cache_status text,
  add column if not exists cover_cache_error text;
