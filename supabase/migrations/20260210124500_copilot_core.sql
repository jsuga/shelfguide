create table if not exists public.copilot_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_genres text[] default '{}'::text[] not null,
  avoided_genres text[] default '{}'::text[] not null,
  preferred_pace text,
  preferred_formats text[] default '{}'::text[] not null,
  notes text,
  updated_at timestamptz default now() not null
);

alter table public.copilot_preferences enable row level security;

create policy "Users can read their own copilot preferences"
  on public.copilot_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert their own copilot preferences"
  on public.copilot_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own copilot preferences"
  on public.copilot_preferences for update
  using (auth.uid() = user_id);

create table if not exists public.copilot_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text,
  title text not null,
  author text,
  genre text,
  tags text[] default '{}'::text[] not null,
  decision text not null check (decision in ('accepted', 'rejected')),
  reason text,
  created_at timestamptz default now() not null
);

create index if not exists copilot_feedback_user_created_at_idx
  on public.copilot_feedback (user_id, created_at desc);

create index if not exists copilot_feedback_user_decision_idx
  on public.copilot_feedback (user_id, decision);

alter table public.copilot_feedback enable row level security;

create policy "Users can read their own copilot feedback"
  on public.copilot_feedback for select
  using (auth.uid() = user_id);

create policy "Users can insert their own copilot feedback"
  on public.copilot_feedback for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own copilot feedback"
  on public.copilot_feedback for delete
  using (auth.uid() = user_id);
