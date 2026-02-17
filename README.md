# ShelfGuide — Because choosing is the hardest part.

ShelfGuide is an AI-powered reading companion that helps you decide what to read next with transparent, genre-aware recommendations.

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

Lovable deploy checklist:
- Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set in the Lovable environment. Missing values force local-only mode and trigger a cloud sync unavailable banner.

Password recovery uses a dedicated reset route:

- App route: `/reset-password`
- Supabase email redirect target: `https://<your-app-origin>/reset-password`

Supabase Dashboard -> Authentication -> URL Configuration:

- Add each environment reset URL to **Redirect URLs**, for example:
- `https://shelfguide.lovable.app/reset-password`
- `http://localhost:4173/reset-password`
- `http://127.0.0.1:4173/reset-password`

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

Core migrations (see `supabase/migrations/`):
- `20260215123000_books_sync_cover_dedupe_upgrade.sql` adds `published_year`, cover fields, and a generated `dedupe_key` (isbn13 -> isbn10 -> title+author+year).
- `20260216120000_books_goodreads_dedupe.sql` adds `goodreads_book_id` and updates `dedupe_key` to prefer Goodreads ids after ISBNs.
- `20260216180000_books_default_library_id_dedupe.sql` adds `default_library_id` and updates `dedupe_key` to include default ids before title/author/year.
- `20260216190000_books_cover_cache.sql` adds `cover_storage_path`, cache timestamps/status, and error fields for Storage-backed covers.

Local storage is still used as a fallback when the user is not signed in.

### Google OAuth setup (Supabase + Google Cloud)

If Google OAuth is not fully configured, the app keeps Google sign-in disabled and shows a "coming soon" hint in the auth dialog. Email/password remains the primary auth path.

Client flag:

```sh
VITE_ENABLE_GOOGLE_OAUTH=true
```

Supabase Dashboard -> Authentication -> URL Configuration:

- Site URL: `https://shelfguide.lovable.app`
- Additional Redirect URLs:
- `https://shelfguide.lovable.app`
- `http://localhost:8081`
- `http://127.0.0.1:8081`
- `http://localhost:4173`
- `http://127.0.0.1:4173`
- `http://localhost:4175`
- `http://127.0.0.1:4175`

Supabase Dashboard -> Authentication -> Providers -> Google:

- Enable Google provider.
- Set Google Client ID and Client Secret from Google Cloud Console.

Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client:

- Authorized JavaScript origins:
- `https://shelfguide.lovable.app`
- `http://localhost:8081`
- `http://127.0.0.1:8081`
- `http://localhost:4173`
- `http://127.0.0.1:4173`
- `http://localhost:4175`
- `http://127.0.0.1:4175`
- Authorized redirect URIs:
- `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`

The app currently sends `redirectTo: window.location.origin` during OAuth start, so each local/dev origin you use should exist in the allowed origin list.

### Supabase Auth email branding (ShelfGuide)

Update these in Supabase Dashboard -> Authentication:

1. Email Templates:
- Replace product naming with `ShelfGuide` in confirmation/reset/invite/magic-link templates.
- Update subject line and preview text to use ShelfGuide wording.
2. SMTP / sender settings:
- Sender name: `ShelfGuide`
- Sender email/domain: your production sender identity.

Production checklist:

- Verify template branding after each Supabase environment promotion.
- Send a test confirmation email and confirm the subject/body show `ShelfGuide` (not repo/project slug names).

## Public Profiles + Public Libraries

Users can opt in to a public profile and be discovered in Community search.

### Data model

- Table: `public.profiles`
- Columns:
- `user_id` (PK, references `auth.users`)
- `username` (unique, required)
- `display_name` (optional)
- `is_public` (default `false`)
- `created_at`

### Privacy model

- Private profiles (`is_public=false`) are not searchable.
- Public search only queries `profiles` where `is_public=true`.
- Public library reads are allowed only when the owner profile is public.
- Owners can always view their own profile/library even when private.

### Username setup and editing

- On sign-up/login bootstrap, app ensures a profile row exists.
- If no profile row exists yet, one is created with a generated username.
- Users can edit username/display name and privacy toggle in **Settings -> Profile**.
- Username rules: `3-24` chars, lowercase letters/numbers/underscore.

### Routes

- Community search: `/community`
- Public profile/library: `/u/:username`

### Search anti-abuse guardrails

- Client-side debounce is applied before running profile search.
- Query is restricted to public profiles only and limited to 20 results per request.

## ShelfGuide Copilot (Edge Function)

This MVP uses a Supabase Edge Function to call Claude Sonnet and fetch book metadata from Google Books, with Open Library as a fallback.

### Supabase secrets

Set these in Supabase Project Settings > Edge Functions > Secrets:

```sh
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-4-20250514
GOOGLE_BOOKS_API_KEY=optional_google_books_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
COPILOT_RPS_WINDOW_MS=600000
COPILOT_USER_LIMIT=200
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

## Row Level Security (RLS)

This project uses RLS on all app tables in the `public` schema. Policies are least-privilege:

- `books`
- `copilot_preferences`
- `copilot_feedback`
- `copilot_recommendations`
- `copilot_rate_limits` (user rows only; IP-based rows are inserted via service role)

Each table has explicit `SELECT`, `INSERT`, `UPDATE`, and `DELETE` policies that enforce `auth.uid() = user_id`.
See `supabase/migrations/20260210142000_rls_policies.sql`.

### Verify RLS in Supabase

1. Run migrations:

```sh
supabase db push
```

2. In Supabase Dashboard, open **Security Advisor** and re-run checks. The "Database Has No Security Policies" warning should be cleared.

### Testing policies (anon/authenticated)

Use the anon client (NOT service role) to verify:

- An authenticated user can only see their own rows.
- An authenticated user cannot read another user's rows.
- An unauthenticated client cannot access protected tables.

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

## CSV Import (Recommended: default template)

The primary import path uses the custom CSV schema with `library_id` for stable, row-by-row imports.
Cover fields are optional: rows without `cover_url` or `thumbnail` are still imported and will render a placeholder cover in the UI.

### Default CSV (recommended)

1. Download the template at `/defaultBookLibrary.csv`.
2. The app exposes a **Download CSV Template** button on **My Library**.

Developer workflow: run `npm run sync:csv-template` to copy the latest Downloads template into `public/defaultBookLibrary.csv`, then commit it to publish.

Required headers (case-insensitive, whitespace-tolerant):

- `library_id`, `title`, `author`, `genre`, `series_name`, `is_first_in_series`, `status`

Re-importing the same file updates rows by `library_id` without creating duplicates.

Optional headers supported:

- `cover_url`, `thumbnail`, `isbn`, `isbn13`, `published_year`, `goodreads_book_id`, `rating`

### Goodreads import (preview)

Goodreads import is available in **My Library** -> **Advanced** as a preview. It is not the primary path for the MSIS 549 demo.

The app maps shelves:

- `to-read` -> `tbr`
- `currently-reading` -> `reading`
- `read` -> `finished`

Duplicates are merged by stable key in this order:

- `isbn13`
- `isbn` (ISBN10 fallback)
- `goodreads_book_id`
- `default_library_id`
- normalized `title + author + published_year`

Cloud import writes are upsert-based and deduped by `books.dedupe_key`:

- If ISBN13 exists: `isbn13:<isbn13>`
- Else if ISBN10 exists: `isbn10:<isbn10>`
- Else if Goodreads ID exists: `gr:<goodreads_book_id>`
- Else if default library id exists: `default:<library_id>`
- Else: `title_author_year:<normalized_title>|<normalized_author>|<published_year_or_unknown>`

If cloud write fails, import data is queued locally and retried in the background; you can also trigger retry manually from **Preferences -> Sync Status**.

## Community Library UI

Public profiles use the same card/grid presentation as **My Library**, including cover placeholders when a cover is missing.

## Session 6.1 Stabilization (Sync + Dedupe + Auth)

### Queue safety and retries

- Queue items are now user-scoped (`user_id` stored per queued item).
- `flushAllPendingSync` only flushes items for the currently authenticated user.
- If no authenticated session exists, queued items remain pending (no flush).
- Legacy queue items without `user_id` are treated as `needs_attention` (never auto-attributed to another user).
- Queue retries are capped at 5 attempts; then items move to `needs_attention` to avoid infinite retry loops.

### Needs-attention handling

- Global sync banner surfaces `needs_attention` counts and details:
  - operation type
  - source
  - last error
  - attempt count
- Banner includes **Dismiss issues** to safely clear `needs_attention` items so sync UI does not remain stuck.

### Shared dedupe key behavior

- Dedupe normalization is centralized in `src/lib/bookDedupe.ts`.
- Key format:
  - `isbn13:<isbn13>` when ISBN13 is present
  - `isbn10:<isbn10>` when ISBN10 is present and ISBN13 is absent
  - `gr:<goodreads_book_id>` when Goodreads ID is present and ISBNs are absent
  - `default:<library_id>` when default library id is present and ISBNs/Goodreads are absent
  - `title_author_year:<normalized_title>|<normalized_author>|<published_year_or_unknown>` otherwise
- Used across manual CSV import, CSV merge (Goodreads export), demo seed checks, and add-to-library flows.

### Database dedupe enforcement

- Migration: `supabase/migrations/20260212183000_books_dedupe_key_upsert.sql`
- Adds generated `books.dedupe_key` and unique index `(user_id, dedupe_key)`.
- Cloud writes use upsert conflict target `user_id,dedupe_key`.
- Dedupe expression was upgraded in `supabase/migrations/20260215123000_books_sync_cover_dedupe_upgrade.sql`.
- Goodreads ID support was added in `supabase/migrations/20260216120000_books_goodreads_dedupe.sql`.

## Session 6.2 Production Fixes

- Auth routing:
  - Authenticated users now default to **My Library** when landing on `/`.
  - Deep links are preserved (no forced redirect away from non-root routes).
- Password recovery:
  - Added **Forgot password?** in Sign In dialog.
  - Added reset route: `/reset-password`.
  - Recovery flow uses Supabase `resetPasswordForEmail` with `redirectTo=<origin>/reset-password`.
- CSV import reliability (Goodreads export supported):
  - Required header validation (`Title`, `Author`) with actionable errors.
  - Progress status and completion summary (`rows read/created/updated/skipped/errors`).
  - Shelf mapping includes `Exclusive Shelf` and `Bookshelves`.
  - Date parsing normalized to ISO date where valid.
- Cover persistence + flicker fixes:
  - Covers persist server-side via `books.cover_url` (legacy `thumbnail` kept in sync).
  - Cover enrichment now uses in-memory + local cache, ISBN-first keys, inflight de-dupe, and request throttling.
  - Cover load failures are logged and persisted via `books.cover_failed_at`.
- Schema/migration:
  - Added `supabase/migrations/20260215123000_books_sync_cover_dedupe_upgrade.sql` for:
    - `published_year`, `cover_url`, `cover_source`, `cover_failed_at`, `updated_at`
    - safer cover-preserving update trigger
    - upgraded dedupe key expression and unique index refresh

### Diagnostics (dev/flagged)

- Preferences page includes a **Diagnostics** block in dev mode, or when:
  - `VITE_ENABLE_SYNC_DIAGNOSTICS=true`
- Diagnostics checks:
  - `dedupe_key` column is selectable
  - upsert conflict path works
  - RLS is likely active for authenticated reads
  - last check timestamp and notes

### Default physical-library CSV template

You can download a starter CSV template from the app:

- Go to **My Library** -> **Download CSV Template**
- Or use the static asset directly: `/defaultBookLibrary.csv`

Template file location in repo:

- `public/defaultBookLibrary.csv`

## Cover Cache (Supabase Storage)

This app caches book covers in Supabase Storage to avoid flaky external URLs.

Setup steps:

1. Create a public Storage bucket named `book-covers`.
2. Run migration `20260216190000_books_cover_cache.sql`.
3. Deploy the edge function:
   - `supabase functions deploy cache-book-cover`
4. Set function secrets:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `COVER_CACHE_ADMIN_KEY` (for the backfill script)

Backfill existing covers (admin-only):

```sh
SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... \
COVER_CACHE_ADMIN_KEY=... \
npm run backfill:cover-cache
```

### Manual library CSV columns

Supported columns for manual library import (`Add Library` CSV flow):

- `library_id` (required; stable per-row id)
- `title` (required)
- `author` (required)
- `genre` (optional)
- `series_name` (optional)
- `is_first_in_series` (optional; accepted values include `1/0`, `true/false`, `yes/no`)
- `status` (optional; accepted values include `TBR`, `Reading`, `Finished`)

## Session 5 Updates

### TBR Wheel

- Added filters for:
  - Genre multi-select (`Fantasy`, `Science Fiction`, `History`, `Romance`, `Thriller`, `Any`)
  - `is_first_in_series` (`Any`, `First in series only`, `Not first in series`)
  - Status (`TBR`, `Reading`, `Finished`, plus existing statuses)
  - Ownership mode (`In my library` vs `Not owned / recommend outside my library`)
- Default wheel status filter is now `TBR`.
- Added ownership behavior:
  - `In my library`: wheel uses matching rows from `books`.
  - `Not owned`: invokes `reading-copilot`, enriches with Google Books metadata, de-dupes against owned books (ISBN/ISBN13 first, else Title+Author), then spins on final candidates.
- Added winner CTA in `Not owned` mode: **Add to Library (TBR)**.
- Added wheel cap behavior and messaging:
  - Max 30 slices.
  - If more matches exist, wheel spins on a random sample with refreshable sampling.

### Data model / migrations

- Added migration `supabase/migrations/20260212103000_enforce_books_first_in_series.sql` to ensure `books.is_first_in_series` exists, defaults to `false`, and is non-null.
- Updated Supabase TypeScript types so `books.is_first_in_series` is non-nullable in generated table row types.

### Theme redesign (Fantasy only)

- Redesigned Fantasy theme to a soft whimsical cottagecore style:
  - Light parchment background
  - Sage primary with dusty rose/lavender accents
  - Softer card surfaces, rounded corners, gentle decorative background motifs
  - Readable contrast and preserved focus/ring tokens
- Other themes remain unchanged.
- Theme persistence remains tied to `copilot_preferences.ui_theme`.

### Validation

- `npm test` passed.
- `npm run lint` passed.

## Session 5.1 Updates

### TBR Wheel UX adjustment

- Updated TBR Wheel filter behavior so **Length** is hidden when ownership mode is **In my library**.
- In library mode, length is forced to `Any` to prevent accidental filtering against missing `page_count` values from default CSV imports.
- Length filtering remains available in **Not owned / recommend outside my library** mode.

### Fantasy theme redesign (balanced pass)

- Reworked Fantasy again to sit between the original dark style and the lighter cottagecore pass:
  - Soft moss/forest-leaning light background (not cream, not dark mode)
  - Deep sage/muted emerald primary
  - Dusty lavender/plum secondary
  - Soft amber highlight accent used sparingly
  - Deep charcoal text for readable but non-harsh contrast
- Added more visual richness without heavy contrast:
  - Layered, subtle gradients for depth
  - Low-opacity botanical/storybook texture treatment in page background
  - Gentle card elevation and rounded cozy surfaces
  - Soft glow/highlight treatment for primary buttons
- Kept all non-Fantasy themes unchanged.

### Validation

- `npm run lint` passed.

## Homepage Genre Image Assets

Homepage and theme preview cards use static images from:

- `public/images/themes/`

Homepage faded theme layer now uses:

- Classic (`default`) -> `shelf1.jpg`
- Romance -> `romance6.jpg`

If you are adding/replacing local Downloads assets, place files at:

- `public/images/themes/shelf1.jpg`
- `public/images/themes/romance6.jpg`

Note: in this repo, `shelf1.jpg` may be a placeholder copy. Replace it with your real `shelf1` image from Downloads using the exact filename above.
If your source files are `.png` instead of `.jpg`, keep them in the same folder and update the paths in `src/index.css`.

If the primary image is missing, the UI falls back to the default faded image:

- `public/images/themes/shelf1.jpg`

This keeps layout stable in development and production while allowing new images to be added incrementally.
