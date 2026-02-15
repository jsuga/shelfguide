-- Strengthen books persistence for account-scoped cloud sync and durable covers.
-- 1) Add published_year + explicit cover fields
-- 2) Ensure cover values are never overwritten with NULL during updates/upserts
-- 3) Upgrade dedupe key to isbn13 -> isbn10 -> title+author+published_year

alter table public.books
  add column if not exists published_year integer,
  add column if not exists cover_url text,
  add column if not exists cover_source text,
  add column if not exists cover_failed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill cover_url from existing thumbnail values when present.
update public.books
set cover_url = coalesce(nullif(btrim(cover_url), ''), nullif(btrim(thumbnail), ''))
where coalesce(nullif(btrim(cover_url), ''), nullif(btrim(thumbnail), '')) is not null;

create index if not exists books_user_published_year_idx on public.books (user_id, published_year);
create index if not exists books_user_cover_failed_at_idx on public.books (user_id, cover_failed_at);

-- Keep updated_at current on writes.
create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists books_set_updated_at on public.books;
create trigger books_set_updated_at
before update on public.books
for each row execute procedure public.set_updated_at_timestamp();

-- Preserve existing cover values if an update provides NULL/blank.
create or replace function public.books_preserve_cover_values()
returns trigger
language plpgsql
as $$
begin
  if new.cover_url is null or btrim(new.cover_url) = '' then
    new.cover_url := old.cover_url;
  end if;

  if new.thumbnail is null or btrim(new.thumbnail) = '' then
    new.thumbnail := old.thumbnail;
  end if;

  if new.cover_source is null or btrim(new.cover_source) = '' then
    new.cover_source := old.cover_source;
  end if;

  -- Keep legacy + canonical fields aligned while both are in use.
  if new.cover_url is null and new.thumbnail is not null then
    new.cover_url := new.thumbnail;
  elsif new.thumbnail is null and new.cover_url is not null then
    new.thumbnail := new.cover_url;
  end if;

  return new;
end;
$$;

drop trigger if exists books_preserve_cover_values_trg on public.books;
create trigger books_preserve_cover_values_trg
before update on public.books
for each row execute procedure public.books_preserve_cover_values();

-- Upgrade dedupe key expression.
drop index if exists books_user_dedupe_key_unique;
alter table public.books drop column if exists dedupe_key;

alter table public.books
  add column dedupe_key text generated always as (
    case
      when nullif(btrim(coalesce(isbn13, '')), '') is not null
        then 'isbn13:' || lower(btrim(isbn13))
      when nullif(btrim(coalesce(isbn, '')), '') is not null
        then 'isbn10:' || lower(btrim(isbn))
      else
        'title_author_year:' ||
        lower(btrim(coalesce(title, ''))) || '|' ||
        lower(btrim(coalesce(author, ''))) || '|' ||
        coalesce(published_year::text, 'unknown')
    end
  ) stored;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, dedupe_key
      order by updated_at desc, created_at desc, id desc
    ) as row_num
  from public.books
)
delete from public.books b
using ranked r
where b.id = r.id
  and r.row_num > 1;

create unique index if not exists books_user_dedupe_key_unique
  on public.books (user_id, dedupe_key);
