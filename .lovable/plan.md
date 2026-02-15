
# ShelfGuide Fixes and UX Improvements

## 1. Remove "Sign in with Google" and "Apple" from Auth UI

**Root cause:** `Navbar.tsx` lines 96-108 contain `handleSocialAuth` for Google and Apple, and lines 218-221 render two social auth buttons ("Continue with Google", "Continue with Apple").

**Fix:**
- Remove the `handleSocialAuth` function
- Remove the `googleOAuthEnabled` env var reference
- Remove both social auth buttons and the "or" divider between them and email/password form
- Keep email/password sign-in/sign-up intact

---

## 2. Cover Loading Resilience

**Root cause analysis:**
- `coverEnrichment.ts` fetches from Google Books API but has no `onError` handler on `<img>` tags in `Library.tsx` (line 980) -- broken images show nothing
- `enrichRunRef` prevents re-running enrichment even if books change (line 198: `if (enrichRunRef.current) return`)
- No dev logging on image load failures

**Fix:**
- Add `onError` handler on cover `<img>` in Library book cards: log the book title + failed URL in dev, set a local `failedCovers` state to show placeholder
- Add dev-only `console.log` in `enrichCovers` for success/failure counts
- Add a "Retry cover" button on cards with failed covers that clears the cache entry and re-runs enrichment for that book
- Reset `enrichRunRef` when books array identity changes (new import)

---

## 3. Library Stats: Fix TBR = 0 and Read Count

**Root cause:** Stats at line 251 check `b.status === "tbr" || b.status === "want_to_read"` for TBR, but `mapShelfToStatus` (line 373) maps Goodreads `to-read` to `"tbr"` while manual adds default to `"want_to_read"`. Both should count. The actual issue is likely that imported books have status `"tbr"` but the books loaded from Supabase may have a different casing or the status field isn't being returned properly.

**Fix:**
- Create a canonical `normalizeStatus(status: string): string` function that maps all variants:
  - `"to-read"`, `"want_to_read"`, `"tbr"`, `"TBR"` -> `"tbr"`
  - `"read"`, `"finished"`, `"Finished"` -> `"finished"`
  - `"currently-reading"`, `"reading"` -> `"reading"`
- Apply normalization in stats computation, in `mapShelfToStatus`, and when displaying status on cards
- Stats labels: show "TBR" for tbr count, "Finished" for finished count
- Add dev log when stats compute showing raw status distribution

---

## 4. TBR Wheel "Start Reading" -- Trace and Fix Persistence

**Root cause:** `startReading` in `TbrWheel.tsx` (line 225-234):
- If user is signed in and `winner.id` exists: updates Supabase directly, reloads books, shows toast -- this works
- If not signed in or no `winner.id`: updates local state via `setBooks`/`setLocalBooks` -- this works for local
- **But**: if the winner came from the library filter (`sourceBooks` filters by `status === "tbr"`), after marking as reading the book should disappear from the wheel source. The `loadBooks` call refreshes this.
- **Missing**: no navigation hint to find the book, and if offline the queue isn't used

**Fix:**
- After `startReading`, show toast with "View in Library" link: `toast.success("Marked as Reading", { action: { label: "View in Library", onClick: () => navigate("/library") } })`
- If online update fails, queue via `enqueueLibrarySync` and apply optimistically to local state
- Add `useNavigate` import

---

## 5. Wheel UX: Full-Screen Spin + Better Labels

**Fix:**
- Wrap the wheel + spin in a `Dialog` (full-screen modal) that opens when user clicks "Spin"
- Inside modal: large wheel (responsive, using `min(80vw, 80vh)` sizing), pointer, and close button
- Labels: change from centered text to text that starts near center and runs outward along the slice midline using `textAnchor="start"` positioned at ~30% radius, rotated to match slice angle
- Increase font sizes, truncate with ellipsis for thin slices
- Keep the inline wheel for browsing; modal only during spin

---

## 6. Copilot "Offline" Message Fix

**Root cause:** `Copilot.tsx` line 302-303: if the edge function call returns an error OR no data, it shows "Copilot is offline." But the error could be auth, network, or the function itself failing.

**Fix:**
- Classify the error: check `navigator.onLine`, check if `userId` is null (not signed in), check error message for 401/403/429
- Show specific messages:
  - No userId: "Sign in for AI-powered recommendations. Showing curated picks."
  - Offline: "No internet connection. Showing curated picks."
  - Auth error: "Session expired. Please sign in again."
  - Other: "Service temporarily unavailable. Showing curated picks."
- Add a "Retry" button next to the status message
- For feedback queuing: change "Feedback queued for cloud sync." to a softer "Will sync when online." and make it a small inline note, not a banner-level cloudNotice

---

## 7. Home Tab Label + Title Formatting

**Fix:**
- In `Navbar.tsx` navLinks array (line 25): change `{ path: "/", label: "Home" }` to `{ path: "/", label: "How it Works" }`
- In `Index.tsx` hero (line 73-75): change the two-line `"How It" / "Works"` to a single line: `"How It Works"` with `whitespace-nowrap` and responsive font sizing (`text-4xl md:text-6xl lg:text-7xl`)

---

## Technical Details

### Files to modify:

| File | Changes |
|------|---------|
| `src/components/Navbar.tsx` | Remove Google/Apple auth buttons, divider, `handleSocialAuth`, `googleOAuthEnabled`. Change "Home" label to "How it Works" |
| `src/pages/Library.tsx` | Add `normalizeStatus` helper, fix stats, add `onError`+logging on cover images, add "Retry cover" per card, reset enrichRunRef on new imports |
| `src/lib/coverEnrichment.ts` | Add dev logging for success/failure counts in `enrichCovers` |
| `src/pages/TbrWheel.tsx` | Add `useNavigate`, improve `startReading` toast with nav link, add offline queueing, wrap wheel in full-screen Dialog for spin mode, improve label layout |
| `src/pages/Copilot.tsx` | Classify edge function errors with specific messages, add Retry button, soften feedback queue message |
| `src/pages/Index.tsx` | Single-line "How It Works" title with `whitespace-nowrap` |

### Non-regression safeguards:
- No changes to `cloudSync.ts`, `bookDedupe.ts`, `profiles.ts`, `profilePrivacy.ts`
- All sync queue logic remains user_id-scoped
- Dedupe keys and upsert paths unchanged
- Local-first behavior preserved in all modified flows
