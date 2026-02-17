create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  is_public boolean not null default false,
  rec_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists is_public boolean not null default false;
alter table public.profiles add column if not exists rec_preferences jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop policy if exists "Profiles readable if public or owner" on public.profiles;
drop policy if exists "Profiles insert own row" on public.profiles;
drop policy if exists "Profiles update own row" on public.profiles;
drop policy if exists "Profiles delete own row" on public.profiles;
drop policy if exists "Profiles read own" on public.profiles;
drop policy if exists "Profiles read public" on public.profiles;

create policy "Profiles read own"
  on public.profiles
  for select
  using (auth.uid() = user_id);

create policy "Profiles read public"
  on public.profiles
  for select
  using (is_public = true);

create policy "Profiles insert own row"
  on public.profiles
  for insert
  with check (auth.uid() = user_id);

create policy "Profiles update own row"
  on public.profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  generated_username text;
begin
  base_username :=
    lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), 'reader'), '[^a-zA-Z0-9_]', '_', 'g'));
  base_username := regexp_replace(base_username, '_+', '_', 'g');
  base_username := trim(both '_' from base_username);
  if length(base_username) < 3 then
    base_username := 'reader';
  end if;
  generated_username := left(base_username, 16) || '_' || substr(new.id::text, 1, 8);

  insert into public.profiles (user_id, username, display_name, is_public)
  values (
    new.id,
    generated_username,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    false
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
