-- Enforce RLS + policies for all app tables in public schema

-- Books
do $$
begin
  if to_regclass('public.books') is not null then
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
  end if;
end $$;

-- Copilot preferences
do $$
begin
  if to_regclass('public.copilot_preferences') is not null then
    alter table public.copilot_preferences enable row level security;

    drop policy if exists "Users can read their own copilot preferences" on public.copilot_preferences;
    drop policy if exists "Users can insert their own copilot preferences" on public.copilot_preferences;
    drop policy if exists "Users can update their own copilot preferences" on public.copilot_preferences;
    drop policy if exists "Users can delete their own copilot preferences" on public.copilot_preferences;

    create policy "Users can read their own copilot preferences"
      on public.copilot_preferences for select
      using (auth.uid() = user_id);

    create policy "Users can insert their own copilot preferences"
      on public.copilot_preferences for insert
      with check (auth.uid() = user_id);

    create policy "Users can update their own copilot preferences"
      on public.copilot_preferences for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);

    create policy "Users can delete their own copilot preferences"
      on public.copilot_preferences for delete
      using (auth.uid() = user_id);
  end if;
end $$;

-- Copilot feedback
do $$
begin
  if to_regclass('public.copilot_feedback') is not null then
    alter table public.copilot_feedback enable row level security;

    drop policy if exists "Users can read their own copilot feedback" on public.copilot_feedback;
    drop policy if exists "Users can insert their own copilot feedback" on public.copilot_feedback;
    drop policy if exists "Users can update their own copilot feedback" on public.copilot_feedback;
    drop policy if exists "Users can delete their own copilot feedback" on public.copilot_feedback;

    create policy "Users can read their own copilot feedback"
      on public.copilot_feedback for select
      using (auth.uid() = user_id);

    create policy "Users can insert their own copilot feedback"
      on public.copilot_feedback for insert
      with check (auth.uid() = user_id);

    create policy "Users can update their own copilot feedback"
      on public.copilot_feedback for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);

    create policy "Users can delete their own copilot feedback"
      on public.copilot_feedback for delete
      using (auth.uid() = user_id);
  end if;
end $$;

-- Copilot recommendations history
do $$
begin
  if to_regclass('public.copilot_recommendations') is not null then
    alter table public.copilot_recommendations enable row level security;

    drop policy if exists "Users can read their own copilot recommendations" on public.copilot_recommendations;
    drop policy if exists "Users can insert their own copilot recommendations" on public.copilot_recommendations;
    drop policy if exists "Users can update their own copilot recommendations" on public.copilot_recommendations;
    drop policy if exists "Users can delete their own copilot recommendations" on public.copilot_recommendations;

    create policy "Users can read their own copilot recommendations"
      on public.copilot_recommendations for select
      using (auth.uid() = user_id);

    create policy "Users can insert their own copilot recommendations"
      on public.copilot_recommendations for insert
      with check (auth.uid() = user_id);

    create policy "Users can update their own copilot recommendations"
      on public.copilot_recommendations for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);

    create policy "Users can delete their own copilot recommendations"
      on public.copilot_recommendations for delete
      using (auth.uid() = user_id);
  end if;
end $$;

-- Copilot rate limits (user rows only; IP-based rows are written by service role)
do $$
begin
  if to_regclass('public.copilot_rate_limits') is not null then
    alter table public.copilot_rate_limits enable row level security;

    drop policy if exists "Users can read their own rate limits" on public.copilot_rate_limits;
    drop policy if exists "Users can insert their own rate limits" on public.copilot_rate_limits;
    drop policy if exists "Users can update their own rate limits" on public.copilot_rate_limits;
    drop policy if exists "Users can delete their own rate limits" on public.copilot_rate_limits;

    create policy "Users can read their own rate limits"
      on public.copilot_rate_limits for select
      using (auth.uid() = user_id);

    create policy "Users can insert their own rate limits"
      on public.copilot_rate_limits for insert
      with check (auth.uid() = user_id);

    create policy "Users can update their own rate limits"
      on public.copilot_rate_limits for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);

    create policy "Users can delete their own rate limits"
      on public.copilot_rate_limits for delete
      using (auth.uid() = user_id);
  end if;
end $$;
