

# ShelfGuide UX + Feature Upgrades Plan

This is a large set of changes across 9 requirements. The plan is organized by priority, with build error fixes first, then feature work.

---

## Phase 0: Fix Build Errors (blocking everything)

The edge function `reading-copilot/index.ts` has type errors from the Supabase client's strict typing and a redeclared `limit` variable. The `ThemeContext.tsx` and `cloudSync.ts` also have type issues.

**Changes:**
- **`supabase/functions/reading-copilot/index.ts`**: Fix the redeclared `limit` variable (rename to `rateLimit`), add `as any` casts for Supabase client calls that conflict with auto-generated types (the edge function uses its own `createClient` without the Database generic), add explicit types for `.map()` callback parameters (`item: any`, `doc: any`, `rec: any`, `part: any`)
- **`src/contexts/ThemeContext.tsx`**: Add null check on line 40 (`if (data && data.ui_theme)`), cast the upsert array to satisfy the type checker
- **`src/lib/cloudSync.ts`**: Fix status type incompatibility by using `as const` on the status literal strings in `enqueueLibrarySync` and `enqueueFeedbackSync`; fix upsert type by casting

---

## Phase 1: Library Search, Stats, and Sorting (Requirement 1)

**New file: `src/lib/librarySort.ts`**
- Export sort functions: `sortByTitle`, `sortByAuthor`, `sortByGenre`, `sortBySeriesFirst`, `sortByAuthorSeriesTogether`
- Series-first sort: group books by `series_name`, sort groups alphabetically, within each group sort by title (proxy for volume order since no `series_index` field exists). Standalone books (no series) appear after series groups per author.
- Multi-sort (Author + series together): primary = author A-Z, within author = series groups together sorted by series name, volumes by title, standalones after series books.

**Changes to `src/pages/Library.tsx`:**
- Add state: `searchQuery`, `sortMode` (enum: `title_az`, `author_az`, `genre_az`, `series_first`, `author_series`)
- Add a search `<Input>` at top of the book grid area, filtering by title/author/series_name/genre (case-insensitive substring match)
- Add a sort `<Select>` dropdown next to search
- Add a stats banner row showing: Total books, TBR count, Read/Finished count, Distinct authors count
- Derive `displayedBooks` via `useMemo` that applies search filter then sort
- All sorting is stable (use `Array.prototype.sort` which is stable in modern JS)

---

## Phase 2: Book Cover Images (Requirement 2)

**New file: `src/lib/coverEnrichment.ts`**
- Exports `enrichCovers(books, onUpdate)` - async function that processes books missing `thumbnail` in batches of 5 concurrent lookups
- For each book: try Google Books API by ISBN-13, then ISBN-10, then title+author fallback
- On success: call `onUpdate(bookIndex, coverUrl)` to update state immediately
- On failure: set a `cover_fetch_failed` flag (stored as a timestamp in localStorage cache `shelfguide-cover-cache`)
- Cache: `Map<dedupeKey, { url: string | null, failedAt: string | null }>` in localStorage to avoid re-fetching
- Rate limiting: max 5 concurrent fetches using a simple semaphore pattern

**Changes to `src/pages/Library.tsx`:**
- After books load, call `enrichCovers()` for books missing thumbnails
- Update book records with resolved `thumbnail` URLs
- Sync updated thumbnails to cloud via existing upsert path
- Book card rendering: show `<img>` if `thumbnail` exists, else show a themed placeholder (BookOpen icon with theme background)
- Use `aspect-[2/3]` for consistent card sizing, `object-cover` for images

**Changes to `src/pages/TbrWheel.tsx`:** Already shows thumbnails for winners - no changes needed.

---

## Phase 3: Delete Library (Requirement 3)

**Changes to `src/pages/Preferences.tsx`:**
- Add a "Danger Zone" section at the bottom with a "Delete My Library" button
- First click opens a Dialog warning: "This will permanently delete all your books, feedback, and recommendations from both local storage and the cloud. This cannot be undone."
- Second step: user must type "DELETE" into an input field, then click "Confirm Delete"
- On confirm:
  1. Delete from cloud: `supabase.from("books").delete().eq("user_id", userId)`
  2. Delete feedback: `supabase.from("copilot_feedback").delete().eq("user_id", userId)`
  3. Delete recommendations: `supabase.from("copilot_recommendations").delete().eq("user_id", userId)`
  4. Delete import logs: `supabase.from("import_logs").delete().eq("user_id", userId)`
  5. Clear localStorage keys: `reading-copilot-library`, `reading-copilot-feedback`, sync queues
  6. Clear sync queue items for this user via `clearNeedsAttentionItems` + direct localStorage removal
  7. Show success toast, close dialog

---

## Phase 4: Remove Sample Library Section (Requirement 4)

**Changes to `src/pages/Library.tsx`:**
- Remove the `demoBooks` array and `handleSeedDemo` function
- Remove the "Demo Mode" / "Sample Library" Card section from the JSX (the card around lines 915-936)
- Remove the `seedingDemo` state variable
- Keep the Goodreads import and CSV upload functionality intact

---

## Phase 5: TBR Wheel Genre Dropdown (Requirement 5)

**Changes to `src/lib/tbrWheel.ts`:**
- Add a helper: `getDistinctGenres(books: TbrBook[]): string[]` - extracts unique genres from user's library, case-normalized and trimmed, sorted alphabetically
- Keep `TBR_WHEEL_GENRES` as the fallback list but expand it to include: Fantasy, Romance, Mystery/Thriller, Sci-Fi, Historical Fiction, Nonfiction, Biography/Memoir, YA, Horror

**Changes to `src/pages/TbrWheel.tsx`:**
- Replace the genre checkbox grid with a single `<Select>` dropdown
- Options: "All Genres" + either the user's distinct library genres (if books exist with genres) or the fallback generic list
- If using fallback genres, show helper text: "These are starter genres. Import your library to see your personal genres."
- The dropdown sets a single genre filter (or "All Genres" for no filter)
- Update `filters.genres` accordingly - when a single genre is selected, set `genres: [selectedGenre]`; when "All Genres", set `genres: ["Any"]`

---

## Phase 6: Cloud Sync Banner Improvements (Requirement 6)

**Changes to `src/components/SyncBanner.tsx`:**
- Update banner text: "Cloud sync is unavailable -- using local-only data for now."
- Add an expandable "Learn more" section that shows the error class: "Network error", "Auth expired", "Permission denied", or the raw error message
- The "Retry sync" button already exists; ensure it shows a friendly message when offline: "You're offline. Sync will resume when you reconnect."
- Already has auto-retry on `online` event and 30s interval - confirm this works

**Changes to `src/lib/cloudSync.ts`:**
- Add a `lastSyncError` field to the sync event data (store in localStorage `shelfguide-last-sync-error` with timestamp)
- Classify errors: network (fetch failed), auth (401/403), permission (RLS), other
- Export `getLastSyncError()` for the banner to display

**Changes to `src/pages/Library.tsx`, `Copilot.tsx`, `TbrWheel.tsx`:**
- Update the `cloudNotice` messages to be more actionable: "Cloud sync is unavailable -- using local-only data for now." (consistent across all pages)

---

## Phase 7: TBR Wheel Visual Redesign (Requirement 7)

**Changes to `src/pages/TbrWheel.tsx`:**
- Replace the current simple radial text layout with a proper pie-slice wheel (SVG-based)
- Each slice: a `<path>` element with the correct arc, filled with a theme-derived color
- Generate a harmonious color sequence from the current theme's CSS variables (primary, accent, secondary) with hue rotation to avoid adjacent identical colors
- Labels: rendered as rotated `<text>` elements inside each slice, truncated with ellipsis if too long
- More items = thinner slices (this happens naturally with SVG arc math)
- Pointer indicator: a fixed triangle/arrow at the top of the wheel
- Spin animation: use CSS `transform: rotate()` with `transition` (already working, just needs the visual upgrade)
- Winner highlight: winning slice briefly pulses/glows after spin

---

## Phase 8: Goodreads Import Fix + Rating (Requirement 8)

**Changes to `src/pages/Library.tsx` - `handleGoodreadsImport`:**
- The Goodreads CSV has columns like `Title`, `Author`, `ISBN`, `ISBN13`, `My Rating`, `Exclusive Shelf`, `Bookshelves`, `Date Read`
- Goodreads wraps ISBN values in `="0123456789"` format - add parsing to strip the `="` prefix and `"` suffix
- Map `Exclusive Shelf` values: `to-read` -> `tbr`, `currently-reading` -> `reading`, `read` -> `finished`
- Parse `My Rating`: store as `rating` (0-5 number, 0 means unrated -> store as null)
- The `rating` field already exists in the books table schema
- Ensure `normalizeHeader` handles Goodreads-specific column names (spaces, mixed case)
- Show rating on book cards as star indicators when present

**Changes to book cards in Library.tsx:**
- Display rating as filled/empty stars when `book.rating` is present and > 0

---

## Phase 9: Home Page -> "How It Works" (Requirement 9)

**Changes to `src/pages/Index.tsx`:**
- Update the hero section headline to "How It Works"
- Simplify content to be an onboarding guide with 3-5 steps:
  1. Import your books (Goodreads CSV or manual add)
  2. Manage your library (organize by status, genre, series)
  3. Spin the TBR Wheel (let chance decide your next read)
  4. Chat with the AI Copilot (get personalized recommendations)
  5. Sync across sessions (your data follows you)
- Keep the theme showcase section
- Keep the CTA at the bottom
- Maintain the existing animation patterns

---

## Non-Regression Safeguards

- All sync queue logic remains user_id-scoped (no cross-user processing)
- Dedupe keys and upsert paths (`user_id,dedupe_key`) remain unchanged
- Profile/public profile routes and visibility logic untouched
- No changes to `src/lib/bookDedupe.ts`, `src/lib/profiles.ts`, `src/lib/profilePrivacy.ts`

---

## Technical Summary of Files Changed

| File | Action |
|------|--------|
| `supabase/functions/reading-copilot/index.ts` | Fix type errors |
| `src/contexts/ThemeContext.tsx` | Fix type errors |
| `src/lib/cloudSync.ts` | Fix type errors, add error classification |
| `src/lib/librarySort.ts` | New - sorting utilities |
| `src/lib/coverEnrichment.ts` | New - cover fetching pipeline |
| `src/lib/tbrWheel.ts` | Add `getDistinctGenres`, expand fallback genres |
| `src/pages/Library.tsx` | Search, stats, sort, covers, remove demo, fix import, show ratings |
| `src/pages/TbrWheel.tsx` | Genre dropdown, SVG wheel redesign |
| `src/pages/Preferences.tsx` | Delete Library with double confirmation |
| `src/pages/Index.tsx` | Rename to "How It Works" |
| `src/components/SyncBanner.tsx` | Improved messaging and error display |

