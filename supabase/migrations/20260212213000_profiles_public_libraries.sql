create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  is_public boolean not null default false,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles readable if public or owner" on public.profiles;
drop policy if exists "Profiles insert own row" on public.profiles;
drop policy if exists "Profiles update own row" on public.profiles;
drop policy if exists "Profiles delete own row" on public.profiles;

create policy "Profiles readable if public or owner"
  on public.profiles
  for select
  using (is_public = true or auth.uid() = user_id);

create policy "Profiles insert own row"
  on public.profiles
  for insert
  with check (auth.uid() = user_id);

create policy "Profiles update own row"
  on public.profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Profiles delete own row"
  on public.profiles
  for delete
  using (auth.uid() = user_id);

drop policy if exists "Public can read books from public profiles" on public.books;
create policy "Public can read books from public profiles"
  on public.books
  for select
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = books.user_id
        and p.is_public = true
    )
  );

create or replace function public.handle_new_user_profile()
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
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    false
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_user_profile();

insert into public.profiles (user_id, username, display_name, is_public)
select
  u.id,
  left(
    coalesce(
      nullif(
        trim(both '_' from regexp_replace(lower(regexp_replace(coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1), 'reader'), '[^a-zA-Z0-9_]', '_', 'g')), '_+', '_', 'g')),
        ''
      ),
      'reader'
    ),
    16
  ) || '_' || substr(u.id::text, 1, 8),
  coalesce(u.raw_user_meta_data ->> 'username', split_part(u.email, '@', 1)),
  false
from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null;

