-- Add default_library_id + include in dedupe order (isbn13 -> isbn10 -> gr -> default -> title+author+year)

alter table public.books
  add column if not exists default_library_id integer;

-- Rebuild dedupe key expression to include default_library_id.
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
      when default_library_id is not null
        then 'default:' || default_library_id::text
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

notify pgrst, 'reload schema';
