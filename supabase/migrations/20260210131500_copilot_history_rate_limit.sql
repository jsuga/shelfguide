create table if not exists public.copilot_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id text,
  title text not null,
  author text,
  genre text,
  tags text[] default '{}'::text[] not null,
  summary text,
  source text,
  reasons text[] default '{}'::text[] not null,
  why_new text,
  created_at timestamptz default now() not null
);

create index if not exists copilot_recommendations_user_created_at_idx
  on public.copilot_recommendations (user_id, created_at desc);

alter table public.copilot_recommendations enable row level security;

create policy "Users can read their own copilot recommendations"
  on public.copilot_recommendations for select
  using (auth.uid() = user_id);

create policy "Users can insert their own copilot recommendations"
  on public.copilot_recommendations for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own copilot recommendations"
  on public.copilot_recommendations for delete
  using (auth.uid() = user_id);

create table if not exists public.copilot_rate_limits (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  user_id uuid references auth.users(id) on delete cascade,
  ip text,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz default now() not null
);

create index if not exists copilot_rate_limits_user_idx
  on public.copilot_rate_limits (user_id);

create index if not exists copilot_rate_limits_ip_idx
  on public.copilot_rate_limits (ip);

alter table public.copilot_rate_limits enable row level security;

create policy "Users can read their own rate limits"
  on public.copilot_rate_limits for select
  using (auth.uid() = user_id);

create policy "Users can insert their own rate limits"
  on public.copilot_rate_limits for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own rate limits"
  on public.copilot_rate_limits for update
  using (auth.uid() = user_id);
