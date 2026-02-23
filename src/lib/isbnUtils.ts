/**
 * ISBN normalization, validation, conversion, and multi-step metadata lookup.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type LookupStatus =
  | "success"
  | "partial"
  | "not_found"
  | "network_error";

export type ScannedBookMeta = {
  title: string;
  author: string;
  genre: string;
  isbn: string;
  isbn13: string;
  description: string;
  thumbnail: string;
  page_count: number | null;
  published_year: number | null;
};

export type ResolvedBookResult =
  | { status: "success"; book: ScannedBookMeta }
  | { status: "partial"; book: ScannedBookMeta }
  | { status: "not_found"; scannedCode: string }
  | { status: "network_error"; scannedCode: string; message: string };

// ── Normalization ──────────────────────────────────────────────────────────

/** Strip everything except digits and trailing X (for ISBN-10 check digit). */
export const normalizeScannedCode = (raw: string): string =>
  raw.replace(/[^0-9xX]/g, "").replace(/x/g, "X").trim();

// ── Validation ─────────────────────────────────────────────────────────────

export const isValidISBN10 = (code: string): boolean => {
  if (code.length !== 10) return false;
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(code[i]);
  sum += code[9] === "X" ? 10 : Number(code[9]);
  return sum % 11 === 0;
};

export const isValidISBN13 = (code: string): boolean => {
  if (code.length !== 13) return false;
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(code[12]);
};

// ── Conversion ─────────────────────────────────────────────────────────────

export const isbn10To13 = (isbn10: string): string | null => {
  if (isbn10.length !== 10) return null;
  const base = "978" + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  const check = (10 - (sum % 10)) % 10;
  return base + String(check);
};

export const isbn13To10 = (isbn13: string): string | null => {
  if (isbn13.length !== 13 || !isbn13.startsWith("978")) return null;
  const base = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(base[i]);
  const rem = (11 - (sum % 11)) % 11;
  return base + (rem === 10 ? "X" : String(rem));
};

// ── Lookup candidates ──────────────────────────────────────────────────────

/** Return an ordered list of ISBN candidates to try from a scanned code. */
export const getLookupCandidatesFromBarcode = (rawCode: string): string[] => {
  const code = normalizeScannedCode(rawCode);
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (c: string | null) => {
    if (c && !seen.has(c)) { seen.add(c); candidates.push(c); }
  };

  if (code.length === 13 && (code.startsWith("978") || code.startsWith("979"))) {
    add(code);
    add(isbn13To10(code));
  } else if (code.length === 10) {
    add(isbn10To13(code));
    add(code);
  } else {
    // Non-standard length — try as-is
    add(code);
  }
  return candidates;
};

// ── Google Books fetch with timeout + retry ────────────────────────────────

const fetchWithTimeout = async (url: string, timeoutMs = 8000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const googleBooksLookup = async (query: string): Promise<ScannedBookMeta | null> => {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1&printType=books`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const data = await res.json();
  const item = data?.items?.[0]?.volumeInfo;
  if (!item) return null;
  return volumeInfoToMeta(item);
};

const volumeInfoToMeta = (item: any): ScannedBookMeta => {
  const identifiers = item.industryIdentifiers || [];
  const isbn13Entry = identifiers.find((i: any) => i.type === "ISBN_13");
  const isbn10Entry = identifiers.find((i: any) => i.type === "ISBN_10");
  const cover = item.imageLinks?.thumbnail || item.imageLinks?.smallThumbnail || "";
  return {
    title: item.title || "",
    author: (item.authors || []).join(", "),
    genre: (item.categories || [])[0] || "",
    isbn: isbn10Entry?.identifier || "",
    isbn13: isbn13Entry?.identifier || "",
    description: item.description || "",
    thumbnail: cover ? cover.replace(/^http:\/\//i, "https://") : "",
    page_count: item.pageCount || null,
    published_year: item.publishedDate
      ? parseInt(item.publishedDate.slice(0, 4), 10) || null
      : null,
  };
};

// ── Multi-step resolver ────────────────────────────────────────────────────

const retryFetch = async (
  fn: () => Promise<ScannedBookMeta | null>,
  retries = 1,
  delayMs = 600,
): Promise<ScannedBookMeta | null> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err: any) {
      if (err?.name === "AbortError" || attempt === retries) throw err;
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
};

/**
 * Resolve book metadata from a scanned barcode using a multi-step fallback strategy.
 *
 * Step A: Exact ISBN queries (isbn:XXX) for each candidate.
 * Step B: Bare numeric query for each candidate.
 * Step C: (caller provides title/author search via manual flow)
 */
export const resolveBookMetadataFromBarcode = async (
  scannedCode: string,
): Promise<ResolvedBookResult> => {
  const code = normalizeScannedCode(scannedCode);
  if (!code || code.length < 10) {
    return { status: "not_found", scannedCode: code };
  }

  const candidates = getLookupCandidatesFromBarcode(code);

  try {
    // Step A — exact isbn: queries
    for (const c of candidates) {
      const result = await retryFetch(() => googleBooksLookup(`isbn:${c}`));
      if (result && result.title) {
        const isPartial = !result.thumbnail && !result.description;
        return { status: isPartial ? "partial" : "success", book: result };
      }
    }

    // Step B — bare query (catches some edge cases)
    for (const c of candidates) {
      const result = await retryFetch(() => googleBooksLookup(c));
      if (result && result.title) {
        return { status: "partial", book: result };
      }
    }

    return { status: "not_found", scannedCode: code };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { status: "network_error", scannedCode: code, message: "Request timed out. Check your connection." };
    }
    return { status: "network_error", scannedCode: code, message: "Network error. Please try again." };
  }
};

/** Search by title/author as a manual fallback. */
export const searchBookByTitleAuthor = async (
  title: string,
  author: string,
): Promise<ScannedBookMeta | null> => {
  const parts: string[] = [];
  if (title.trim()) parts.push(`intitle:${title.trim()}`);
  if (author.trim()) parts.push(`inauthor:${author.trim()}`);
  if (parts.length === 0) return null;
  return retryFetch(() => googleBooksLookup(parts.join(" ")));
};
