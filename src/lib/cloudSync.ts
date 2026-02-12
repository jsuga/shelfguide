import { supabase } from "@/integrations/supabase/client";

export const SYNC_EVENT = "shelfguide-sync-updated";
const LIBRARY_QUEUE_KEY = "shelfguide-pending-library-sync";
const FEEDBACK_QUEUE_KEY = "shelfguide-pending-feedback-sync";

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
  id: string;
  source: string;
  fileName?: string;
  books: CloudBookUpsert[];
  created_at: string;
};

type FeedbackSyncTask = {
  id: string;
  entry: FeedbackQueueEntry;
  created_at: string;
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

const writeJson = <T>(key: string, value: T[]) => {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(SYNC_EVENT));
};

const nextId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const getPendingSyncCounts = () => {
  const library = readJson<LibrarySyncTask>(LIBRARY_QUEUE_KEY).length;
  const feedback = readJson<FeedbackSyncTask>(FEEDBACK_QUEUE_KEY).length;
  return { library, feedback, total: library + feedback };
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
  return supabase
    .from("books")
    .upsert(
      books.map((book) => ({ ...book, user_id: userId })),
      { onConflict: "user_id,dedupe_key", ignoreDuplicates: false }
    );
};

export const enqueueLibrarySync = (
  books: CloudBookUpsert[],
  source: string,
  fileName?: string
) => {
  const existing = readJson<LibrarySyncTask>(LIBRARY_QUEUE_KEY);
  const next: LibrarySyncTask[] = [
    {
      id: nextId(),
      source,
      fileName,
      books,
      created_at: new Date().toISOString(),
    },
    ...existing,
  ];
  writeJson(LIBRARY_QUEUE_KEY, next);
};

export const enqueueFeedbackSync = (entry: FeedbackQueueEntry) => {
  const existing = readJson<FeedbackSyncTask>(FEEDBACK_QUEUE_KEY);
  const next: FeedbackSyncTask[] = [
    { id: nextId(), entry, created_at: new Date().toISOString() },
    ...existing,
  ];
  writeJson(FEEDBACK_QUEUE_KEY, next);
};

export const flushLibraryQueue = async (userId: string) => {
  const queue = readJson<LibrarySyncTask>(LIBRARY_QUEUE_KEY);
  if (!queue.length) return { synced: 0, failed: 0, errorMessages: [] as string[] };

  const remaining: LibrarySyncTask[] = [];
  let synced = 0;
  let failed = 0;
  const errorMessages: string[] = [];

  for (const task of queue.reverse()) {
    const { error } = await retryAsync(() => upsertBooksToCloud(userId, task.books), 1, 450);
    if (error) {
      remaining.push(task);
      failed += 1;
      errorMessages.push(error.message);
      continue;
    }
    synced += task.books.length;
  }

  writeJson(LIBRARY_QUEUE_KEY, remaining.reverse());
  return { synced, failed, errorMessages };
};

export const flushFeedbackQueue = async (userId: string) => {
  const queue = readJson<FeedbackSyncTask>(FEEDBACK_QUEUE_KEY);
  if (!queue.length) return { synced: 0, failed: 0, errorMessages: [] as string[] };

  const remaining: FeedbackSyncTask[] = [];
  let synced = 0;
  let failed = 0;
  const errorMessages: string[] = [];

  for (const task of queue.reverse()) {
    const { error } = await retryAsync(
      () =>
        supabase.from("copilot_feedback").insert([
          {
            ...task.entry,
            user_id: userId,
          },
        ]),
      1,
      450
    );
    if (error) {
      remaining.push(task);
      failed += 1;
      errorMessages.push(error.message);
      continue;
    }
    synced += 1;
  }

  writeJson(FEEDBACK_QUEUE_KEY, remaining.reverse());
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
