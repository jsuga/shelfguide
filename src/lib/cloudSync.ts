import { supabase } from "@/integrations/supabase/client";
import { buildBookDedupeKey } from "@/lib/bookDedupe";

export const SYNC_EVENT = "shelfguide-sync-updated";
const LIBRARY_QUEUE_KEY = "shelfguide-pending-library-sync";
const FEEDBACK_QUEUE_KEY = "shelfguide-pending-feedback-sync";
const LAST_SYNC_ERROR_KEY = "shelfguide-last-sync-error";
const MAX_SYNC_ATTEMPTS = 5;
const ORPHANED_QUEUE_ERROR = "Queued item missing user_id. Dismiss and recreate while signed in.";

export type CloudBookUpsert = {
  id?: string;
  user_id?: string;
  title: string;
  author: string;
  genre?: string | null;
  series_name?: string | null;
  is_first_in_series?: boolean;
  status?: string | null;
  isbn?: string | null;
  isbn13?: string | null;
  goodreads_book_id?: string | null;
  default_library_id?: number | null;
  published_year?: number | null;
  rating?: number | null;
  date_read?: string | null;
  shelf?: string | null;
  description?: string | null;
  page_count?: number | null;
  thumbnail?: string | null;
  cover_url?: string | null;
  cover_source?: string | null;
  cover_failed_at?: string | null;
  source?: string | null;
  explicit_nulls?: Array<"rating">;
};

export type FeedbackQueueEntry = {
  book_id: string | null;
  title: string;
  author: string | null;
  genre: string | null;
  tags: string[];
  decision: "accepted" | "rejected";
  created_at: string;
};

type LibrarySyncTask = {
  user_id: string | null;
  id: string;
  operation: "library_upsert";
  status: "pending" | "needs_attention";
  attempt_count: number;
  last_error: string | null;
  last_error_class?: SyncErrorClass | null;
  last_attempt_at: string | null;
  source: string;
  fileName?: string;
  books: CloudBookUpsert[];
  created_at: string;
};

type FeedbackSyncTask = {
  user_id: string | null;
  id: string;
  operation: "feedback_insert";
  status: "pending" | "needs_attention";
  attempt_count: number;
  last_error: string | null;
  last_error_class?: SyncErrorClass | null;
  last_attempt_at: string | null;
  entry: FeedbackQueueEntry;
  created_at: string;
};

export type NeedsAttentionItem = {
  id: string;
  operation: "library_upsert" | "feedback_insert";
  source: string;
  error: string;
  attempts: number;
  created_at: string;
};

export type SyncErrorClass =
  | "network"
  | "auth"
  | "permission"
  | "schema_cache"
  | "missing_table"
  | "project_mismatch"
  | "other";

export type LastSyncError = {
  message: string;
  errorClass: SyncErrorClass;
  timestamp: string;
  operation?: string;
  table?: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
  projectRef?: string | null;
  userId?: string | null;
  hasSession?: boolean;
  userMessage?: string | null;
  actionHint?: string | null;
};

const classifyError = (msg: string): SyncErrorClass => {
  const lower = msg.toLowerCase();
  if (lower.includes("schema cache")) return "schema_cache";
  if (lower.includes("could not find the table") || (lower.includes("relation") && lower.includes("does not exist")))
    return "missing_table";
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("offline") ||
    lower.includes("failed to fetch")
  )
    return "network";
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("auth") ||
    lower.includes("jwt") ||
    lower.includes("token")
  )
    return "auth";
  if (lower.includes("rls") || lower.includes("permission") || lower.includes("policy") || lower.includes("row-level"))
    return "permission";
  return "other";
};

export const getSupabaseProjectRef = () => {
  const url = import.meta.env.VITE_SUPABASE_URL || "";
  try {
    const hostname = new URL(url).hostname;
    const [projectRef] = hostname.split(".");
    return projectRef || null;
  } catch {
    return null;
  }
};

const buildUserMessage = (errorClass: SyncErrorClass, projectRef: string | null) => {
  switch (errorClass) {
    case "schema_cache":
      return "Supabase schema cache needs refresh. Run NOTIFY pgrst, 'reload schema'; in the Supabase SQL Editor, then retry.";
    case "missing_table":
    case "project_mismatch":
      return `Connected to Supabase project ${projectRef || "(unknown)"} but books table missing. Check VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in local + Lovable env.`;
    case "auth":
      return "Session expired. Please sign in again.";
    case "permission":
      return "RLS blocked this operation. Check policies for public.books.";
    case "network":
      return "Network error. Check your connection and retry.";
    default:
      return "Cloud sync is unavailable. Using local-only data for now.";
  }
};

const buildActionHint = (errorClass: SyncErrorClass) => {
  if (errorClass === "schema_cache") {
    return "Supabase SQL Editor: NOTIFY pgrst, 'reload schema'; if it persists, verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
  }
  if (errorClass === "missing_table" || errorClass === "project_mismatch") {
    return "Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set for this environment.";
  }
  if (errorClass === "permission") {
    return "Ensure RLS policies allow auth.uid() = user_id for select/insert/update/delete.";
  }
  return null;
};

export const setLastSyncError = (entry: LastSyncError) => {
  localStorage.setItem(LAST_SYNC_ERROR_KEY, JSON.stringify(entry));
  window.dispatchEvent(new Event(SYNC_EVENT));
};

export const clearLastSyncError = () => {
  localStorage.removeItem(LAST_SYNC_ERROR_KEY);
  window.dispatchEvent(new Event(SYNC_EVENT));
};

export const getLastSyncError = (): LastSyncError | null => {
  try {
    const raw = localStorage.getItem(LAST_SYNC_ERROR_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastSyncError;
  } catch {
    return null;
  }
};

export const recordSyncError = async (params: {
  error: any;
  operation: string;
  table?: string;
  userId?: string | null;
}) => {
  const error = params.error || {};
  const message = (error?.message || error || "Unknown error").toString();
  const lower = `${message} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  const projectRef = getSupabaseProjectRef();
  let errorClass = classifyError(message);
  if (errorClass === "missing_table" && lower.includes("public.books")) {
    errorClass = "project_mismatch";
  }
  const entry: LastSyncError = {
    message,
    errorClass,
    timestamp: new Date().toISOString(),
    operation: params.operation,
    table: params.table,
    code: error?.code ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    status: error?.status ?? error?.statusCode ?? null,
    projectRef,
    userId: params.userId ?? null,
    hasSession: !!(await supabase.auth.getSession()).data.session,
    userMessage: buildUserMessage(errorClass, projectRef),
    actionHint: buildActionHint(errorClass),
  };
  setLastSyncError(entry);
  console.error("[ShelfGuide] Cloud sync error:", {
    operation: entry.operation,
    table: entry.table,
    message: entry.message,
    code: entry.code,
    details: entry.details,
    hint: entry.hint,
    status: entry.status,
    projectRef: entry.projectRef,
    userId: entry.userId,
    hasSession: entry.hasSession,
  });
  return entry;
};

const readJson = <T,>(key: string): T[] => {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
};

const readLibraryQueue = () =>
  readJson<Partial<LibrarySyncTask>>(LIBRARY_QUEUE_KEY).map((task) => ({
    user_id: task.user_id ?? null,
    id: task.id || nextId(),
    operation: "library_upsert" as const,
    status: (task.user_id == null
      ? "needs_attention"
      : task.status === "needs_attention"
        ? "needs_attention"
        : "pending") as "pending" | "needs_attention",
    attempt_count:
      task.user_id == null ? MAX_SYNC_ATTEMPTS : Number.isFinite(task.attempt_count) ? Number(task.attempt_count) : 0,
    last_error: task.user_id == null ? ORPHANED_QUEUE_ERROR : (task.last_error ?? null),
    last_error_class: task.last_error_class ?? null,
    last_attempt_at: task.last_attempt_at ?? null,
    source: task.source || "library_sync",
    fileName: task.fileName,
    books: Array.isArray(task.books) ? (task.books as CloudBookUpsert[]) : [],
    created_at: task.created_at || new Date().toISOString(),
  }));

const readFeedbackQueue = () =>
  readJson<Partial<FeedbackSyncTask>>(FEEDBACK_QUEUE_KEY).map((task) => ({
    user_id: task.user_id ?? null,
    id: task.id || nextId(),
    operation: "feedback_insert" as const,
    status: (task.user_id == null
      ? "needs_attention"
      : task.status === "needs_attention"
        ? "needs_attention"
        : "pending") as "pending" | "needs_attention",
    attempt_count:
      task.user_id == null ? MAX_SYNC_ATTEMPTS : Number.isFinite(task.attempt_count) ? Number(task.attempt_count) : 0,
    last_error: task.user_id == null ? ORPHANED_QUEUE_ERROR : (task.last_error ?? null),
    last_error_class: task.last_error_class ?? null,
    last_attempt_at: task.last_attempt_at ?? null,
    entry:
      task.entry ||
      ({
        book_id: null,
        title: "",
        author: null,
        genre: null,
        tags: [],
        decision: "accepted",
        created_at: new Date().toISOString(),
      } as FeedbackQueueEntry),
    created_at: task.created_at || new Date().toISOString(),
  }));

const writeJson = <T,>(key: string, value: T[]) => {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(SYNC_EVENT));
};

const nextId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const getPendingSyncCounts = (userId: string | null) => {
  const library = readLibraryQueue().filter((task) => task.user_id === userId && task.status === "pending").length;
  const feedback = readFeedbackQueue().filter((task) => task.user_id === userId && task.status === "pending").length;
  const needsAttention =
    readLibraryQueue().filter((task) => task.user_id === userId && task.status === "needs_attention").length +
    readFeedbackQueue().filter((task) => task.user_id === userId && task.status === "needs_attention").length;
  return { library, feedback, total: library + feedback, needsAttention };
};

export const getNeedsAttentionItems = (userId: string | null): NeedsAttentionItem[] => {
  const libraryItems = readLibraryQueue()
    .filter((task) => task.user_id === userId && task.status === "needs_attention")
    .map((task) => ({
      id: task.id,
      operation: task.operation,
      source: task.source || "Library sync",
      error: task.last_error || "Unknown error",
      attempts: task.attempt_count,
      created_at: task.created_at,
    }));

  const feedbackItems = readFeedbackQueue()
    .filter((task) => task.user_id === userId && task.status === "needs_attention")
    .map((task) => ({
      id: task.id,
      operation: task.operation,
      source: "Copilot feedback",
      error: task.last_error || "Unknown error",
      attempts: task.attempt_count,
      created_at: task.created_at,
    }));

  return [...libraryItems, ...feedbackItems].sort((a, b) => b.created_at.localeCompare(a.created_at));
};

export const retryAsync = async <T,>(task: () => Promise<T>, retries = 2, baseDelayMs = 400): Promise<T> => {
  let lastResult: T | null = null;
  let lastThrownError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await task();
      lastResult = result;
      const maybeError = (result as { error?: { message?: string } } | null)?.error;
      if (!maybeError) {
        return result;
      }
      if (attempt >= retries) {
        return result;
      }
    } catch (error) {
      lastThrownError = error;
      if (attempt >= retries) break;
    }
    if (attempt < retries) {
      const delay = baseDelayMs * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  if (lastResult) {
    return lastResult;
  }
  throw lastThrownError;
};

const computeBackoffMs = (attempt: number, errorClass: SyncErrorClass | null | undefined) => {
  if (!errorClass) return 0;
  if (errorClass === "schema_cache" || errorClass === "missing_table" || errorClass === "project_mismatch") {
    return Math.min(1000 * 60 * 10, 1200 * Math.pow(2, Math.max(0, attempt)));
  }
  if (errorClass === "network") {
    return Math.min(1000 * 60 * 5, 800 * Math.pow(2, Math.max(0, attempt)));
  }
  return 0;
};

const shouldDeferRetry = (task: {
  last_attempt_at: string | null;
  attempt_count: number;
  last_error_class?: SyncErrorClass | null;
}) => {
  const delay = computeBackoffMs(task.attempt_count, task.last_error_class);
  if (!delay) return false;
  if (!task.last_attempt_at) return false;
  const elapsed = Date.now() - new Date(task.last_attempt_at).getTime();
  return elapsed < delay;
};

const isNonEmptyValue = (value: unknown) => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  return true;
};

const mergeBookRows = (current: CloudBookUpsert, incoming: CloudBookUpsert) => {
  const merged: CloudBookUpsert = { ...current };
  const currentClearRating = Array.isArray(current.explicit_nulls) && current.explicit_nulls.includes("rating");
  const incomingClearRating = Array.isArray(incoming.explicit_nulls) && incoming.explicit_nulls.includes("rating");
  const explicitClearRating = currentClearRating || incomingClearRating;
  const hasIncomingRating = typeof incoming.rating === "number" && Number.isFinite(incoming.rating);

  const prefer = (key: keyof CloudBookUpsert) => {
    const existingValue = merged[key];
    const incomingValue = incoming[key];
    if (!isNonEmptyValue(existingValue) && isNonEmptyValue(incomingValue)) {
      (merged as Record<string, unknown>)[key as string] = incomingValue as unknown;
    }
  };

  prefer("title");
  prefer("author");
  prefer("genre");
  prefer("series_name");
  prefer("is_first_in_series");
  prefer("status");
  prefer("isbn");
  prefer("isbn13");
  prefer("goodreads_book_id");
  prefer("default_library_id");
  prefer("published_year");
  prefer("date_read");
  prefer("shelf");
  prefer("description");
  prefer("page_count");
  prefer("source");

  // Preserve existing cover values when duplicates appear.
  prefer("cover_url");
  prefer("thumbnail");
  prefer("cover_source");
  prefer("cover_failed_at");

  if (hasIncomingRating) {
    merged.rating = incoming.rating;
  }

  const hasMergedRating = typeof merged.rating === "number" && Number.isFinite(merged.rating);
  if (!hasMergedRating && explicitClearRating) {
    merged.rating = null;
    merged.explicit_nulls = ["rating"];
  } else if (hasMergedRating && Array.isArray(merged.explicit_nulls)) {
    merged.explicit_nulls = merged.explicit_nulls.filter((value) => value !== "rating");
    if (merged.explicit_nulls.length === 0) delete merged.explicit_nulls;
  }

  return merged;
};

const dedupeBooksForUpsert = (rows: CloudBookUpsert[]) => {
  const map = new Map<string, CloudBookUpsert>();
  for (const row of rows) {
    const key = buildBookDedupeKey({
      title: row.title || "",
      author: row.author || "",
      isbn: row.isbn ?? null,
      isbn13: row.isbn13 ?? null,
      goodreads_book_id: row.goodreads_book_id ?? null,
      default_library_id: row.default_library_id ?? null,
      published_year: row.published_year ?? null,
    });
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row });
      continue;
    }
    map.set(key, mergeBookRows(existing, row));
  }
  return Array.from(map.values());
};

export const getAuthenticatedUserId = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  const fromSession = sessionData.session?.user?.id;
  if (fromSession) return fromSession;

  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
};

export const upsertBooksToCloud = async (userId: string, books: CloudBookUpsert[]) => {
  if (!books.length) return { data: null, error: null };
  const payload = books.map((book) => {
    const coverUrl = (book.cover_url || book.thumbnail || "").trim() || null;
    const next: CloudBookUpsert = {
      ...book,
      title: book.title.trim(),
      author: book.author.trim(),
      isbn: book.isbn?.trim() || null,
      isbn13: book.isbn13?.trim() || null,
      goodreads_book_id: book.goodreads_book_id?.toString().trim() || null,
      default_library_id:
        typeof book.default_library_id === "number" && Number.isFinite(book.default_library_id)
          ? Math.trunc(book.default_library_id)
          : null,
      published_year:
        typeof book.published_year === "number" && Number.isFinite(book.published_year) ? book.published_year : null,
      cover_url: coverUrl,
      thumbnail: coverUrl,
      user_id: userId,
    };
    return next;
  });

  const deduped = dedupeBooksForUpsert(payload as CloudBookUpsert[]);
  const finalPayload = deduped.map((row) => {
    const next: Record<string, unknown> = { ...row };
    // Avoid clearing server-side values on partial updates.
    if (next.cover_url === null) delete next.cover_url;
    if (next.thumbnail === null) delete next.thumbnail;
    const allowNullRating = Array.isArray(row.explicit_nulls) && row.explicit_nulls.includes("rating");
    if (!allowNullRating && (next.rating === null || typeof next.rating === "undefined")) {
      delete next.rating;
    }
    if (next.status == null) delete next.status;
    delete (next as Record<string, unknown>).explicit_nulls;
    return next as CloudBookUpsert;
  });

  const cleanRows = finalPayload.map(({ dedupe_key, created_at, updated_at, ...rest }: any) => rest);

  const attemptUpsert = (rows: CloudBookUpsert[]) =>
    (supabase as any).from("books").upsert(cleanRows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: false });

  const initial = await attemptUpsert(finalPayload);
  if (!(initial as any)?.error || finalPayload.length <= 1) return initial;

  const chunkSize = Math.max(1, Math.min(50, Math.ceil(finalPayload.length / 2)));
  let chunkError: any = null;
  for (let i = 0; i < finalPayload.length; i += chunkSize) {
    const chunk = finalPayload.slice(i, i + chunkSize);
    const result = await attemptUpsert(chunk);
    if ((result as any)?.error) {
      chunkError = (result as any).error;
      break;
    }
  }

  return { data: null, error: chunkError };
};

export const enqueueLibrarySync = (
  userId: string | null,
  books: CloudBookUpsert[],
  source: string,
  fileName?: string,
) => {
  const existing = readLibraryQueue();
  const next: LibrarySyncTask[] = [
    {
      user_id: userId,
      id: nextId(),
      operation: "library_upsert" as const,
      status: "pending" as const,
      attempt_count: 0,
      last_error: null,
      last_error_class: null,
      last_attempt_at: null,
      source,
      fileName,
      books,
      created_at: new Date().toISOString(),
    },
    ...existing,
  ];
  writeJson(LIBRARY_QUEUE_KEY, next);
};

export const enqueueFeedbackSync = (userId: string | null, entry: FeedbackQueueEntry) => {
  const existing = readFeedbackQueue();
  const next: FeedbackSyncTask[] = [
    {
      user_id: userId,
      id: nextId(),
      operation: "feedback_insert" as const,
      status: "pending" as const,
      attempt_count: 0,
      last_error: null,
      last_error_class: null,
      last_attempt_at: null,
      entry,
      created_at: new Date().toISOString(),
    },
    ...existing,
  ];
  writeJson(FEEDBACK_QUEUE_KEY, next);
};

export const flushLibraryQueue = async (userId: string) => {
  const queue = readLibraryQueue();
  if (!queue.length) return { synced: 0, failed: 0, errorMessages: [] as string[] };

  const remaining: LibrarySyncTask[] = [];
  let synced = 0;
  let failed = 0;
  const errorMessages: string[] = [];

  for (const task of queue.reverse()) {
    if (task.user_id !== userId) {
      remaining.push(task);
      continue;
    }
    if (task.status === "needs_attention" || task.attempt_count >= MAX_SYNC_ATTEMPTS) {
      remaining.push({
        ...task,
        status: "needs_attention" as const,
      });
      continue;
    }
    if (shouldDeferRetry(task)) {
      remaining.push(task);
      continue;
    }
    const result = await retryAsync(() => upsertBooksToCloud(userId, task.books), 1, 450);
    const error = (result as any)?.error;
    if (error) {
      const syncError = await recordSyncError({
        error,
        operation: "upsert",
        table: "books",
        userId,
      });
      const message = error?.message || "Unknown error";
      const nextAttempt = task.attempt_count + 1;
      remaining.push({
        ...task,
        attempt_count: nextAttempt,
        last_error: message,
        last_error_class: syncError.errorClass,
        last_attempt_at: new Date().toISOString(),
        status: (nextAttempt >= MAX_SYNC_ATTEMPTS ? "needs_attention" : "pending") as "pending" | "needs_attention",
      });
      failed += 1;
      errorMessages.push(message);
      continue;
    }
    synced += task.books.length;
  }

  writeJson(LIBRARY_QUEUE_KEY, remaining.reverse());
  if (synced > 0 && failed === 0) clearLastSyncError();
  return { synced, failed, errorMessages };
};

export const flushFeedbackQueue = async (userId: string) => {
  const queue = readFeedbackQueue();
  if (!queue.length) return { synced: 0, failed: 0, errorMessages: [] as string[] };

  const remaining: FeedbackSyncTask[] = [];
  let synced = 0;
  let failed = 0;
  const errorMessages: string[] = [];

  for (const task of queue.reverse()) {
    if (task.user_id !== userId) {
      remaining.push(task);
      continue;
    }
    if (task.status === "needs_attention" || task.attempt_count >= MAX_SYNC_ATTEMPTS) {
      remaining.push({
        ...task,
        status: "needs_attention" as const,
      });
      continue;
    }
    if (shouldDeferRetry(task)) {
      remaining.push(task);
      continue;
    }
    if (!task.entry.title || !task.entry.decision) {
      remaining.push({
        ...task,
        attempt_count: MAX_SYNC_ATTEMPTS,
        last_error: "Missing required feedback fields.",
        last_error_class: "other",
        last_attempt_at: new Date().toISOString(),
        status: "needs_attention" as const,
      });
      failed += 1;
      errorMessages.push("Missing required feedback fields.");
      continue;
    }
    const result = await retryAsync(
      () =>
        (supabase as any).from("copilot_feedback").insert([
          {
            ...task.entry,
            user_id: userId,
          },
        ]),
      1,
      450,
    );
    const error = (result as any)?.error;
    if (error) {
      const syncError = await recordSyncError({
        error,
        operation: "insert",
        table: "copilot_feedback",
        userId,
      });
      const message = error?.message || "Unknown error";
      const nextAttempt = task.attempt_count + 1;
      remaining.push({
        ...task,
        attempt_count: nextAttempt,
        last_error: message,
        last_error_class: syncError.errorClass,
        last_attempt_at: new Date().toISOString(),
        status: (nextAttempt >= MAX_SYNC_ATTEMPTS ? "needs_attention" : "pending") as "pending" | "needs_attention",
      });
      failed += 1;
      errorMessages.push(message);
      continue;
    }
    synced += 1;
  }

  writeJson(FEEDBACK_QUEUE_KEY, remaining.reverse());
  if (synced > 0 && failed === 0) clearLastSyncError();
  return { synced, failed, errorMessages };
};

export const flushAllPendingSync = async () => {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { synced: 0, failed: 0, errorMessages: ["Not authenticated."] };

  const [library, feedback] = await Promise.all([flushLibraryQueue(userId), flushFeedbackQueue(userId)]);

  return {
    synced: library.synced + feedback.synced,
    failed: library.failed + feedback.failed,
    errorMessages: [...library.errorMessages, ...feedback.errorMessages],
  };
};

export const checkCloudHealth = async (userId: string | null) => {
  if (!userId) return { ok: false, reason: "not_authenticated" as const };
  const result: any = await retryAsync(() => (supabase as any).from("books").select("id").limit(1), 1, 250);
  const { error } = result || {};
  if (error) {
    await recordSyncError({ error, operation: "select", table: "books", userId });
    return { ok: false, reason: "error" as const, error };
  }
  clearLastSyncError();
  return { ok: true as const };
};

export const clearNeedsAttentionItems = (userId: string | null) => {
  const libraryRemaining = readLibraryQueue().filter(
    (task) => !(task.user_id === userId && task.status === "needs_attention"),
  );
  const feedbackRemaining = readFeedbackQueue().filter(
    (task) => !(task.user_id === userId && task.status === "needs_attention"),
  );
  writeJson(LIBRARY_QUEUE_KEY, libraryRemaining);
  writeJson(FEEDBACK_QUEUE_KEY, feedbackRemaining);
};
