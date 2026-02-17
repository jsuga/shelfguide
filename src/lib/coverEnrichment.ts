const CACHE_KEY = "shelfguide-cover-cache";
const MAX_CONCURRENT = 3;
const REQUEST_GAP_MS = 140;
const FAILED_TTL_MS = 1000 * 60 * 60 * 24;

type CoverCacheEntry = { url: string | null; failedAt: string | null };
type CoverCache = Record<string, CoverCacheEntry>;

const inMemoryCache = new Map<string, CoverCacheEntry>();
const inflightLookups = new Map<string, Promise<string | null>>();
let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadCache = (): CoverCache => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
};

const saveCache = (cache: CoverCache) => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
};

const normalizeIsbn = (raw: string | null | undefined) => {
  if (!raw) return "";
  return raw.replace(/^="?|"$/g, "").replace(/[^0-9xX]/g, "").trim().toLowerCase();
};

export const buildCoverCacheKey = (book: { title: string; author: string; isbn?: string | null; isbn13?: string | null }) => {
  const isbn13 = normalizeIsbn(book.isbn13);
  if (isbn13) return `isbn13:${isbn13}`;
  const isbn = normalizeIsbn(book.isbn);
  if (isbn) return `isbn10:${isbn}`;
  return `title_author:${book.title.trim().toLowerCase()}|${book.author.trim().toLowerCase()}`;
};

const hasFreshFailure = (entry: CoverCacheEntry | undefined) => {
  if (!entry?.failedAt) return false;
  const timestamp = new Date(entry.failedAt).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp < FAILED_TTL_MS;
};

const rateLimitedFetch = async (url: string) => {
  const now = Date.now();
  const waitFor = Math.max(0, REQUEST_GAP_MS - (now - lastRequestAt));
  if (waitFor > 0) await sleep(waitFor);
  lastRequestAt = Date.now();
  return fetch(url);
};

const normalizeCoverUrl = (url: string | null) => {
  if (!url) return null;
  return url.replace(/^http:\/\//i, "https://");
};

const fetchGoogleCover = async (query: string): Promise<string | null> => {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("printType", "books");
  try {
    const res = await rateLimitedFetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.items?.[0]?.volumeInfo;
    const image = item?.imageLinks?.thumbnail || item?.imageLinks?.smallThumbnail || null;
    return typeof image === "string" ? normalizeCoverUrl(image) : null;
  } catch {
    return null;
  }
};

const lookupCover = async (book: {
  title: string;
  author: string;
  isbn?: string | null;
  isbn13?: string | null;
}): Promise<string | null> => {
  const key = buildCoverCacheKey(book);
  const pending = inflightLookups.get(key);
  if (pending) return pending;

  const lookupPromise = (async () => {
    const isbn13 = normalizeIsbn(book.isbn13);
    const isbn = normalizeIsbn(book.isbn);

    if (isbn13) {
      const url = await fetchGoogleCover(`isbn:${isbn13}`);
      if (url) return url;
    }
    if (isbn) {
      const url = await fetchGoogleCover(`isbn:${isbn}`);
      if (url) return url;
    }
    if (book.title.trim() && book.author.trim()) {
      return fetchGoogleCover(`intitle:${book.title} inauthor:${book.author}`);
    }
    if (book.title.trim()) {
      return fetchGoogleCover(`intitle:${book.title}`);
    }
    return null;
  })();

  inflightLookups.set(key, lookupPromise);
  try {
    return await lookupPromise;
  } finally {
    inflightLookups.delete(key);
  }
};

export type EnrichableBook = {
  title: string;
  author: string;
  isbn?: string | null;
  isbn13?: string | null;
  thumbnail?: string | null;
  cover_url?: string | null;
};

export const enrichCovers = async <T extends EnrichableBook>(
  books: T[],
  onUpdate: (index: number, coverUrl: string) => void
): Promise<void> => {
  const persistedCache = loadCache();
  const toFetch: { index: number; key: string; book: T }[] = [];

  for (let i = 0; i < books.length; i += 1) {
    const book = books[i];
    if (book.cover_url || book.thumbnail) continue;

    const key = buildCoverCacheKey(book);
    const memoized = inMemoryCache.get(key);
    if (memoized) {
      if (memoized.url) onUpdate(i, memoized.url);
      continue;
    }

    const cached = persistedCache[key];
    if (cached) {
      inMemoryCache.set(key, cached);
      if (cached.url) {
        onUpdate(i, cached.url);
      }
      continue;
    }

    toFetch.push({ index: i, key, book });
  }

  if (toFetch.length === 0) {
    if (import.meta.env.DEV) {
      console.log("[ShelfGuide] Cover enrichment: nothing to fetch (all cached or already persisted).");
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.log(`[ShelfGuide] Cover enrichment: fetching ${toFetch.length} covers with throttling...`);
  }

  let successCount = 0;
  let failCount = 0;
  let cursor = 0;

  const runWorker = async (): Promise<void> => {
    while (cursor < toFetch.length) {
      const current = toFetch[cursor];
      cursor += 1;

      const existingFailure = persistedCache[current.key] || inMemoryCache.get(current.key);
      if (hasFreshFailure(existingFailure)) {
        continue;
      }

      const url = await lookupCover(current.book);
      const entry: CoverCacheEntry = {
        url,
        failedAt: url ? null : new Date().toISOString(),
      };
      persistedCache[current.key] = entry;
      inMemoryCache.set(current.key, entry);

      if (url) {
        onUpdate(current.index, url);
        successCount += 1;
      } else {
        failCount += 1;
      }

      saveCache(persistedCache);
    }
  };

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, toFetch.length) },
    () => runWorker()
  );
  await Promise.all(workers);

  if (import.meta.env.DEV) {
    console.log(`[ShelfGuide] Cover enrichment complete: ${successCount} found, ${failCount} failed.`);
  }
};

export const lookupCoverForBook = async (book: {
  title: string;
  author: string;
  isbn?: string | null;
  isbn13?: string | null;
}) => {
  const url = await lookupCover(book);
  return normalizeCoverUrl(url);
};

export const clearCoverCacheForBook = (book: {
  title: string;
  author: string;
  isbn?: string | null;
  isbn13?: string | null;
}) => {
  const key = buildCoverCacheKey(book);
  inMemoryCache.delete(key);
  const cache = loadCache();
  delete cache[key];
  saveCache(cache);
};
