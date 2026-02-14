import { supabase } from "@/integrations/supabase/client";

export const SYNC_EVENT = "shelfguide-sync-updated";
const LIBRARY_QUEUE_KEY = "shelfguide-pending-library-sync";
const FEEDBACK_QUEUE_KEY = "shelfguide-pending-feedback-sync";
const LAST_SYNC_ERROR_KEY = "shelfguide-last-sync-error";
const MAX_SYNC_ATTEMPTS = 5;
const ORPHANED_QUEUE_ERROR = "Queued item missing user_id. Dismiss and recreate while signed in.";

export type CloudBookUpsert = {
  id?: string;
  title: string;
  author: string;
  genre?: string | null;
  series_name?: string | null;
  is_first_in_series?: boolean;
  status?: string | null;
  isbn?: string | null;
  isbn13?: string | null;
  rating?: number | null;
  date_read?: string | null;
  shelf?: string | null;
  description?: string | null;
  page_count?: number | null;
  thumbnail?: string | null;
  source?: string | null;
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

export type SyncErrorClass = "network" | "auth" | "permission" | "other";

export type LastSyncError = {
  message: string;
  errorClass: SyncErrorClass;
  timestamp: string;
};

const classifyError = (msg: string): SyncErrorClass => {
  const lower = msg.toLowerCase();
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("offline") || lower.includes("failed to fetch"))
    return "network";
  if (lower.includes("401") || lower.includes("403") || lower.includes("auth") || lower.includes("jwt") || lower.includes("token"))
    return "auth";
  if (lower.includes("rls") || lower.includes("permission") || lower.includes("policy") || lower.includes("row-level"))
    return "permission";
  return "other";
};

export const setLastSyncError = (message: string) => {
  const entry: LastSyncError = {
    message,
    errorClass: classifyError(message),
    timestamp: new Date().toISOString(),
  };
  localStorage.setItem(LAST_SYNC_ERROR_KEY, JSON.stringify(entry));
};

export const clearLastSyncError = () => {
  localStorage.removeItem(LAST_SYNC_ERROR_KEY);
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

const readJson = <T>(key: string): T[] => {
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
    status: (
      task.user_id == null
        ? "needs_attention"
        : task.status === "needs_attention"
        ? "needs_attention"
        : "pending"
    ) as "pending" | "needs_attention",
    attempt_count:
      task.user_id == null
        ? MAX_SYNC_ATTEMPTS
        : Number.isFinite(task.attempt_count)
        ? Number(task.attempt_count)
        : 0,
    last_error: task.user_id == null ? ORPHANED_QUEUE_ERROR : task.last_error ?? null,
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
    status: (
      task.user_id == null
        ? "needs_attention"
        : task.status === "needs_attention"
        ? "needs_attention"
        : "pending"
    ) as "pending" | "needs_attention",
    attempt_count:
      task.user_id == null
        ? MAX_SYNC_ATTEMPTS
        : Number.isFinite(task.attempt_count)
        ? Number(task.attempt_count)
        : 0,
    last_error: task.user_id == null ? ORPHANED_QUEUE_ERROR : task.last_error ?? null,
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

const writeJson = <T>(key: string, value: T[]) => {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(SYNC_EVENT));
};

const nextId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const getPendingSyncCounts = (userId: string | null) => {
  const library = readLibraryQueue().filter(
    (task) => task.user_id === userId && task.status === "pending"
  ).length;
  const feedback = readFeedbackQueue().filter(
    (task) => task.user_id === userId && task.status === "pending"
  ).length;
  const needsAttention =
    readLibraryQueue().filter(
      (task) => task.user_id === userId && task.status === "needs_attention"
    ).length +
    readFeedbackQueue().filter(
      (task) => task.user_id === userId && task.status === "needs_attention"
    ).length;
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

  return [...libraryItems, ...feedbackItems].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );
};

export const retryAsync = async <T>(
  task: () => Promise<T>,
  retries = 2,
  baseDelayMs = 400
): Promise<T> => {
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

export const getAuthenticatedUserId = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  const fromSession = sessionData.session?.user?.id;
  if (fromSession) return fromSession;

  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
};

export const upsertBooksToCloud = async (userId: string, books: CloudBookUpsert[]) => {
  if (!books.length) return { data: null, error: null };
  return (supabase as any)
    .from("books")
    .upsert(
      books.map((book) => ({
        ...book,
        title: book.title.trim(),
        author: book.author.trim(),
        isbn13: book.isbn13?.trim() || null,
        user_id: userId,
      })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: false }
    );
};

export const enqueueLibrarySync = (
  userId: string | null,
  books: CloudBookUpsert[],
  source: string,
  fileName?: string
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
    const result = await retryAsync(() => upsertBooksToCloud(userId, task.books), 1, 450);
    const error = (result as any)?.error;
    if (error) {
      const nextAttempt = task.attempt_count + 1;
      remaining.push({
        ...task,
        attempt_count: nextAttempt,
        last_error: error.message,
        last_attempt_at: new Date().toISOString(),
        status: (nextAttempt >= MAX_SYNC_ATTEMPTS ? "needs_attention" : "pending") as "pending" | "needs_attention",
      });
      failed += 1;
      errorMessages.push(error.message);
      setLastSyncError(error.message);
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
    if (!task.entry.title || !task.entry.decision) {
      remaining.push({
        ...task,
        attempt_count: MAX_SYNC_ATTEMPTS,
        last_error: "Missing required feedback fields.",
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
      450
    );
    const error = (result as any)?.error;
    if (error) {
      const nextAttempt = task.attempt_count + 1;
      remaining.push({
        ...task,
        attempt_count: nextAttempt,
        last_error: error.message,
        last_attempt_at: new Date().toISOString(),
        status: (nextAttempt >= MAX_SYNC_ATTEMPTS ? "needs_attention" : "pending") as "pending" | "needs_attention",
      });
      failed += 1;
      errorMessages.push(error.message);
      setLastSyncError(error.message);
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

  const [library, feedback] = await Promise.all([
    flushLibraryQueue(userId),
    flushFeedbackQueue(userId),
  ]);

  return {
    synced: library.synced + feedback.synced,
    failed: library.failed + feedback.failed,
    errorMessages: [...library.errorMessages, ...feedback.errorMessages],
  };
};

export const clearNeedsAttentionItems = (userId: string | null) => {
  const libraryRemaining = readLibraryQueue().filter(
    (task) => !(task.user_id === userId && task.status === "needs_attention")
  );
  const feedbackRemaining = readFeedbackQueue().filter(
    (task) => !(task.user_id === userId && task.status === "needs_attention")
  );
  writeJson(LIBRARY_QUEUE_KEY, libraryRemaining);
  writeJson(FEEDBACK_QUEUE_KEY, feedbackRemaining);
};
