-- Core books table (idempotent)
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  author text not null,
  genre text,
  series_name text,
  is_first_in_series boolean default false,
  status text default 'want_to_read',
  created_at timestamptz default now(),
  isbn text,
  isbn13 text,
  rating numeric,
  date_read date,
  shelf text,
  description text,
  page_count integer,
  thumbnail text,
  source text default 'manual'
);

alter table public.books enable row level security;

drop policy if exists "Users can read their own books" on public.books;
drop policy if exists "Users can insert their own books" on public.books;
drop policy if exists "Users can update their own books" on public.books;
drop policy if exists "Users can delete their own books" on public.books;

create policy "Users can read their own books"
  on public.books for select
  using (auth.uid() = user_id);

create policy "Users can insert their own books"
  on public.books for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own books"
  on public.books for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own books"
  on public.books for delete
  using (auth.uid() = user_id);
