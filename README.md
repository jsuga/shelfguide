# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Supabase Library Sync (MVP)

This project supports email/password auth and a `books` table in Supabase.

Environment variables required in `.env`:

```sh
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
```

Create the `books` table and enable RLS:

```sql
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  author text not null,
  genre text,
  series_name text,
  is_first_in_series boolean default false,
  status text default 'want_to_read',
  created_at timestamptz default now()
);

alter table public.books enable row level security;

create policy "Users can read their own books"
  on public.books for select
  using (auth.uid() = user_id);

create policy "Users can insert their own books"
  on public.books for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own books"
  on public.books for update
  using (auth.uid() = user_id);

create policy "Users can delete their own books"
  on public.books for delete
  using (auth.uid() = user_id);
```

Local storage is still used as a fallback when the user is not signed in.

## Reading Copilot (Edge Function)

This MVP uses a Supabase Edge Function to call Claude Sonnet and fetch book metadata from Google Books, with Open Library as a fallback.

### Supabase secrets

Set these in Supabase Project Settings > Edge Functions > Secrets:

```sh
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-20250514
GOOGLE_BOOKS_API_KEY=optional_google_books_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
COPILOT_RPS_WINDOW_MS=600000
COPILOT_USER_LIMIT=20
COPILOT_IP_LIMIT=8
```

### Migrations

Run migrations in `supabase/migrations` to create:

- `copilot_preferences`
- `copilot_feedback`
- `copilot_recommendations`
- `copilot_rate_limits`

### Deploy the function

Deploy the function `reading-copilot` and keep `SUPABASE_URL` and `SUPABASE_ANON_KEY` available in the function environment.

If the AI key is missing or rate-limited, the UI will fall back to local recommendations.

### Smoke test (local or remote)

Set the following environment variables and run:

```sh
SUPABASE_URL=your_project_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_ACCESS_TOKEN=your_user_access_token
```

Then:

```sh
npm run test:copilot
```

Where to get them:

- `SUPABASE_URL`: Supabase Project Settings -> API -> Project URL.
- `SUPABASE_ANON_KEY`: Supabase Project Settings -> API -> anon public key.
- `SUPABASE_ACCESS_TOKEN`: Sign in via the app in your browser, open DevTools -> Application -> Local Storage, and copy the `access_token` from the `sb-<project-ref>-auth-token` entry.
