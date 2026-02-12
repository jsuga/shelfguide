alter table public.books
  add column if not exists is_first_in_series boolean default false;

update public.books
set is_first_in_series = false
where is_first_in_series is null;

alter table public.books
  alter column is_first_in_series set default false,
  alter column is_first_in_series set not null;
