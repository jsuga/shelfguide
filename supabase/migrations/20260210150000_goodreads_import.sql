-- Goodreads import support

do $$
begin
  if to_regclass('public.books') is not null then
    alter table public.books
      add column if not exists isbn text,
      add column if not exists isbn13 text,
      add column if not exists rating numeric,
      add column if not exists date_read date,
      add column if not exists shelf text,
      add column if not exists description text,
      add column if not exists page_count integer,
      add column if not exists thumbnail text,
      add column if not exists source text default 'manual';

    create index if not exists books_user_isbn_idx on public.books (user_id, isbn);
    create index if not exists books_user_isbn13_idx on public.books (user_id, isbn13);
    create index if not exists books_user_title_author_idx on public.books (user_id, title, author);
  end if;
end $$;

create table if not exists public.import_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  added_count integer not null default 0,
  updated_count integer not null default 0,
  failed_count integer not null default 0,
  failures jsonb,
  created_at timestamptz default now() not null
);

create index if not exists import_logs_user_created_at_idx
  on public.import_logs (user_id, created_at desc);

alter table public.import_logs enable row level security;

drop policy if exists "Users can read their own import logs" on public.import_logs;
drop policy if exists "Users can insert their own import logs" on public.import_logs;
drop policy if exists "Users can update their own import logs" on public.import_logs;
drop policy if exists "Users can delete their own import logs" on public.import_logs;

create policy "Users can read their own import logs"
  on public.import_logs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own import logs"
  on public.import_logs for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own import logs"
  on public.import_logs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own import logs"
  on public.import_logs for delete
  using (auth.uid() = user_id);
