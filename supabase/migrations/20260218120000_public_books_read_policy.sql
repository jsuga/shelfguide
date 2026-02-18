-- Allow public read of books when the owner's profile is public, while preserving owner-only writes.

alter table public.books enable row level security;

drop policy if exists "Public can read books from public profiles" on public.books;
create policy "Public can read books from public profiles"
  on public.books
  for select
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.profiles p
      where p.user_id = books.user_id
        and p.is_public = true
    )
  );
