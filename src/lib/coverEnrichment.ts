const CACHE_KEY = "shelfguide-cover-cache";
const MAX_CONCURRENT = 5;

type CoverCacheEntry = { url: string | null; failedAt: string | null };
type CoverCache = Record<string, CoverCacheEntry>;

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

const cacheKey = (title: string, author: string) =>
  `${title.trim().toLowerCase()}|${author.trim().toLowerCase()}`;

const stripIsbn = (raw: string | null | undefined) => {
  if (!raw) return null;
  return raw.replace(/^="?|"$/g, "").trim() || null;
};

const fetchGoogleCover = async (query: string): Promise<string | null> => {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("printType", "books");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.items?.[0]?.volumeInfo;
    return item?.imageLinks?.thumbnail || item?.imageLinks?.smallThumbnail || null;
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
  const isbn13 = stripIsbn(book.isbn13);
  const isbn = stripIsbn(book.isbn);

  if (isbn13) {
    const url = await fetchGoogleCover(`isbn:${isbn13}`);
    if (url) return url;
  }
  if (isbn) {
    const url = await fetchGoogleCover(`isbn:${isbn}`);
    if (url) return url;
  }
  return fetchGoogleCover(`intitle:${book.title} inauthor:${book.author}`);
};

export type EnrichableBook = {
  title: string;
  author: string;
  isbn?: string | null;
  isbn13?: string | null;
  thumbnail?: string | null;
};

export const enrichCovers = async <T extends EnrichableBook>(
  books: T[],
  onUpdate: (index: number, coverUrl: string) => void
): Promise<void> => {
  const cache = loadCache();
  const toFetch: { index: number; book: T }[] = [];

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (book.thumbnail) continue;

    const key = cacheKey(book.title, book.author);
    const cached = cache[key];
    if (cached) {
      if (cached.url) {
        onUpdate(i, cached.url);
      }
      continue;
    }
    toFetch.push({ index: i, book });
  }

  if (toFetch.length === 0) {
    if (import.meta.env.DEV) console.log("[ShelfGuide] Cover enrichment: nothing to fetch (all cached or have covers).");
    return;
  }
  if (import.meta.env.DEV) console.log(`[ShelfGuide] Cover enrichment: fetching ${toFetch.length} covers...`);
  let successCount = 0;
  let failCount = 0;

  let running = 0;
  let cursor = 0;

  const processNext = (): Promise<void> => {
    if (cursor >= toFetch.length) return Promise.resolve();
    const item = toFetch[cursor++];
    running++;

    return lookupCover(item.book).then((url) => {
      const key = cacheKey(item.book.title, item.book.author);
      if (url) {
        cache[key] = { url, failedAt: null };
        onUpdate(item.index, url);
        successCount++;
      } else {
        cache[key] = { url: null, failedAt: new Date().toISOString() };
        failCount++;
      }
      running--;
      saveCache(cache);
      return processNext();
    });
  };

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, toFetch.length) },
    () => processNext()
  );
  await Promise.all(workers);
  if (import.meta.env.DEV) console.log(`[ShelfGuide] Cover enrichment complete: ${successCount} found, ${failCount} failed.`);
};
