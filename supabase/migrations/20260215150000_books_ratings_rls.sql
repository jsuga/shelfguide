-- Ensure books table supports ratings + required columns, with RLS and upsert indexes.

alter table public.books
  add column if not exists status text default 'tbr',
  add column if not exists thumbnail text,
  add column if not exists cover_url text,
  add column if not exists rating smallint;

-- Normalize rating type to smallint when the column exists.
alter table public.books
  alter column rating type smallint
  using case
    when rating is null then null
    else round(rating)::smallint
  end;

-- Enforce rating range 1-5 when present.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'books_rating_range_check'
  ) then
    alter table public.books
      add constraint books_rating_range_check
      check (rating is null or (rating >= 1 and rating <= 5));
  end if;
end $$;

-- Ensure dedupe index used by upserts.
create unique index if not exists books_user_dedupe_key_unique
  on public.books (user_id, dedupe_key);

-- RLS safety: scope rows to auth.uid().
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
