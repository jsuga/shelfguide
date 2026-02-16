-- Add Goodreads book id + include in dedupe key order (isbn13 -> isbn10 -> gr -> title+author+year)

alter table public.books
  add column if not exists goodreads_book_id text;

-- Rebuild dedupe key expression to include Goodreads ids.
drop index if exists books_user_dedupe_key_unique;
alter table public.books drop column if exists dedupe_key;

alter table public.books
  add column dedupe_key text generated always as (
    case
      when nullif(btrim(coalesce(isbn13, '')), '') is not null
        then 'isbn13:' || lower(btrim(isbn13))
      when nullif(btrim(coalesce(isbn, '')), '') is not null
        then 'isbn10:' || lower(btrim(isbn))
      when nullif(btrim(coalesce(goodreads_book_id, '')), '') is not null
        then 'gr:' || lower(btrim(goodreads_book_id))
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
