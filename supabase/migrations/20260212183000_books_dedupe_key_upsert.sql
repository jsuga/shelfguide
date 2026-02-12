-- Enforce import dedupe: isbn13 when present, otherwise normalized title+author.
alter table public.books
  add column if not exists dedupe_key text generated always as (
    case
      when nullif(btrim(coalesce(isbn13, '')), '') is not null
        then 'isbn13:' || lower(btrim(isbn13))
      else 'title_author:' || lower(btrim(title)) || '|' || lower(btrim(author))
    end
  ) stored;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, dedupe_key
      order by created_at desc, id desc
    ) as row_num
  from public.books
)
delete from public.books b
using ranked r
where b.id = r.id
  and r.row_num > 1;

create unique index if not exists books_user_dedupe_key_unique
  on public.books (user_id, dedupe_key);

