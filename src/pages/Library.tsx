import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import StarRating from "@/components/StarRating";
import SearchInput from "@/components/SearchInput";
import StatusSelector from "@/components/StatusSelector";
import BookCard from "@/components/books/BookCard";
import BookGrid from "@/components/books/BookGrid";
import BookNotes from "@/components/books/BookNotes";
import BookScanner from "@/components/books/BookScanner";
import { supabase } from "@/integrations/supabase/client";
import {
  enqueueLibrarySync,
  recordSyncError,
  flushAllPendingSync,
  getPendingSyncCounts,
  checkCloudHealth,
  getAuthenticatedUserId,
  retryAsync,
  upsertBooksToCloud,
} from "@/lib/cloudSync";
import { buildBookDedupeKey } from "@/lib/bookDedupe";
import { applySort, type SortMode } from "@/lib/librarySort";
import { enrichCovers, lookupCoverForBook, clearCoverCacheForBook } from "@/lib/coverEnrichment";
import { parseLibraryCsv } from "@/lib/csvImport";

type LibraryBook = {
  id?: string;
  title: string;
  author: string;
  genre: string;
  series_name: string | null;
  is_first_in_series: boolean;
  status: string;
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
  cover_storage_path?: string | null;
  cover_cached_at?: string | null;
  cover_cache_status?: string | null;
  cover_cache_error?: string | null;
  cover_source?: string | null;
  cover_failed_at?: string | null;
  source?: string | null;
  user_comment?: string | null;
};

const ENABLE_COVER_CACHE = true;

const db = supabase as any;

/** Canonical status normalizer - single source of truth */
export const normalizeStatus = (raw: string | null | undefined): string => {
  if (!raw) return "tbr";
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["tbr", "to_read", "want_to_read"].includes(s)) return "tbr";
  if (["reading", "currently_reading"].includes(s)) return "reading";
  if (["read", "finished"].includes(s)) return "finished";
  if (s === "paused") return "paused";
  return s;
};

/** Classify sync error for user-facing label */
const classifySyncError = (error: any): string => {
  if (!navigator.onLine) return "Offline";
  const msg = (error?.message || error || "").toString().toLowerCase();
  if (msg.includes("401") || msg.includes("403") || msg.includes("jwt") || msg.includes("auth") || msg.includes("token"))
    return "Signed out";
  if (msg.includes("rls") || msg.includes("permission") || msg.includes("policy"))
    return "Permission denied";
  if (msg.includes("5") && msg.match(/5\d\d/))
    return "Service error";
  return "Service error";
};

const Library = () => {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [isFirstInSeries, setIsFirstInSeries] = useState(false);
  const [status, setStatus] = useState("tbr");
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editSeriesName, setEditSeriesName] = useState("");
  const [editIsFirstInSeries, setEditIsFirstInSeries] = useState(false);
  const [editStatus, setEditStatus] = useState("tbr");
  const [userId, setUserId] = useState<string | null>(null);
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("title_az");
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());
  const [savingRatings, setSavingRatings] = useState<Record<string, boolean>>({});
  const [savingStatuses, setSavingStatuses] = useState<Record<string, boolean>>({});
  const [coverRetryTokens, setCoverRetryTokens] = useState<Record<string, number>>({});
  const [coverRetrying, setCoverRetrying] = useState<Record<string, boolean>>({});
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [refreshingCovers, setRefreshingCovers] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const coverCacheInFlightRef = useRef<Set<string>>(new Set());
  const coverCacheAttemptedRef = useRef<Set<string>>(new Set());
  const coverCacheProcessingRef = useRef(false);
  const coverCacheAuthNoticeRef = useRef(false);
  const coverCacheErrorLoggedRef = useRef<Set<string>>(new Set());
  const [scannerOpen, setScannerOpen] = useState(false);

  const existingIsbns = useMemo(() => {
    const set = new Set<string>();
    books.forEach((b) => {
      if (b.isbn) set.add(b.isbn.replace(/[^0-9xX]/g, "").trim());
      if (b.isbn13) set.add(b.isbn13.replace(/[^0-9xX]/g, "").trim());
    });
    return set;
  }, [books]);

  const getLocalBooks = () => {
    const stored = localStorage.getItem("reading-copilot-library");
    if (!stored) return [];
    try {
      return JSON.parse(stored) as LibraryBook[];
    } catch {
      return [];
    }
  };

  const setLocalBooks = (nextBooks: LibraryBook[]) => {
    localStorage.setItem("reading-copilot-library", JSON.stringify(nextBooks));
  };

  const loadBooks = useCallback(async (userIdValue: string | null) => {
    if (!userIdValue) {
      setBooks(getLocalBooks());
      return;
    }
    setLoadingBooks(true);
    const result: any = await retryAsync(
      () =>
        db
          .from("books")
          .select("*")
          .eq("user_id", userIdValue)
          .order("created_at", { ascending: false }),
      1,
      350
    );
    const { data, error } = result;
    setLoadingBooks(false);

    if (error) {
      const reason = classifySyncError(error);
      const syncError = await recordSyncError({ error, operation: "select", table: "books", userId: userIdValue });
      if (import.meta.env.DEV) console.warn("[ShelfGuide] loadBooks failed:", { reason, error: error.message, timestamp: new Date().toISOString() });
      // Never show raw internal/technical messages to users
      const rawMsg = syncError.userMessage || "";
      const isInternal = /pgrst|reload schema|schema cache|postgrest|supabase.*project|VITE_/i.test(rawMsg);
      const friendlyMsg = isInternal
        ? "Something went wrong. Please refresh and try again."
        : rawMsg || `Cloud sync is unavailable. Using local-only data for now.`;
      setCloudNotice(friendlyMsg);
      if (isInternal && import.meta.env.DEV) console.warn("[ShelfGuide] Suppressed internal error from UI:", rawMsg);
      setBooks(getLocalBooks());
      return;
    }
    // Cloud succeeded - clear any previous notice
    setCloudNotice(null);

    const cloudBooks = (data || []) as LibraryBook[];
    const localBooks = getLocalBooks();
    const health = await checkCloudHealth(userIdValue);
    const pending = getPendingSyncCounts(userIdValue);
    const hasPending = pending.total > 0;

    let allowReplace = health.ok && !hasPending;
    if (health.ok && hasPending && localBooks.length > 0) {
      setCloudNotice(`${pending.total} items pending sync. Keeping local library until sync completes or you confirm.`);
      allowReplace = window.confirm(
        `There are ${pending.total} pending sync item(s). Click OK to load cloud anyway, or Cancel to keep local until sync completes.`
      );
    } else if (health.ok && hasPending) {
      setCloudNotice(`${pending.total} items pending sync. Keeping local library until sync completes.`);
    }

    if (allowReplace) {
      setBooks(cloudBooks);
      setLocalBooks(cloudBooks);
    } else {
      setBooks(localBooks);
    }

    if (cloudBooks.length === 0 && localBooks.length > 0 && userIdValue) {
      const { error: insertError } = await db
        .from("books")
        .insert(localBooks.map((book: LibraryBook) => {
          const { dedupe_key, created_at, updated_at, ...rest } = book as any;
          return { ...rest, user_id: userIdValue };
        }));
      if (!insertError) {
        setLocalBooks([]);
        const { data: refreshed } = await db
          .from("books")
          .select("*")
          .eq("user_id", userIdValue)
          .order("created_at", { ascending: false });
        setBooks((refreshed || []) as LibraryBook[]);
        toast.success("Migrated your local library to the cloud.");
      }
    }
  }, []);

  // Cover enrichment effect. Fetch covers only for rows missing persisted cover values.
  const enrichRunRef = useRef(false);
  const lastBookCountRef = useRef(0);
  useEffect(() => {
    if (books.length !== lastBookCountRef.current) {
      enrichRunRef.current = false;
      lastBookCountRef.current = books.length;
    }
    if (books.length === 0 || enrichRunRef.current) return;
    const needsCovers = books.some((b) => !(b.cover_url || b.thumbnail));
    if (!needsCovers) return;
    enrichRunRef.current = true;
    const snapshot = [...books];
    if (import.meta.env.DEV) {
      console.log(
        "[ShelfGuide] Starting cover enrichment for",
        books.filter((b) => !(b.cover_url || b.thumbnail)).length,
        "books without covers"
      );
    }
    enrichCovers(snapshot, (index, coverUrl) => {
      const target = snapshot[index];
      if (!target || !coverUrl) return;
      const targetKey = buildBookDedupeKey(target);
      setBooks((prev) => {
        const next = prev.map((entry) =>
          buildBookDedupeKey(entry) === targetKey
            ? {
                ...entry,
                cover_url: coverUrl,
                thumbnail: coverUrl,
                cover_source: entry.cover_source || "google_books",
                cover_failed_at: null,
              }
            : entry
        );
        setLocalBooks(next);
        return next;
      });
      if (userId) {
        upsertBooksToCloud(userId, [
          {
            ...target,
            cover_url: coverUrl,
            thumbnail: coverUrl,
            cover_source: "google_books",
            cover_failed_at: null,
          },
        ]).catch(async (err) => {
          await recordSyncError({ error: err, operation: "upsert", table: "books", userId });
          if (import.meta.env.DEV) {
            console.warn("[ShelfGuide] Cover sync to cloud failed:", err);
          }
        });
      }
    });
  }, [books, userId]);

  useEffect(() => {
    if (!ENABLE_COVER_CACHE) return;
    if (!userId || books.length === 0) return;
    const candidates = books.filter(
      (book) =>
        !!book.id &&
        !book.cover_storage_path &&
        (book.cover_url || book.thumbnail) &&
        !coverCacheAttemptedRef.current.has(book.id || "") &&
        !(
          book.cover_cache_status === "failed" &&
          /404|cors|failed to fetch/i.test(book.cover_cache_error || "")
        )
    );
    if (candidates.length === 0) return;

    const pending = candidates.filter((book) => !coverCacheAttemptedRef.current.has(book.id || ""));
    if (pending.length === 0) return;
    pending.forEach((book) => {
      if (book.id) {
        coverCacheAttemptedRef.current.add(book.id);
        coverCacheInFlightRef.current.add(book.id);
      }
    });

    const run = async () => {
      if (coverCacheProcessingRef.current) return;
      coverCacheProcessingRef.current = true;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (!coverCacheAuthNoticeRef.current) {
            coverCacheAuthNoticeRef.current = true;
            toast.message("Sign in to cache book covers.");
          }
          return;
        }
        const batchSize = 5;
        for (let i = 0; i < pending.length; i += batchSize) {
          const batch = pending.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (book) => {
              try {
                const result = await supabase.functions.invoke("cache-book-cover", {
                  body: { book_id: book.id },
                });
                const error = (result as any)?.error;
                const data = (result as any)?.data || {};
                const errorMessage =
                  error?.message ||
                  data?.error ||
                  "Cover cache failed.";
                const errorStatus = error?.status ?? null;
                const shouldStopRetry =
                  errorStatus === 404 ||
                  /cors|failed to fetch/i.test(errorMessage);
                if (error || !data?.cover_storage_path) {
                  setBooks((prev) => {
                    const next = prev.map((entry) =>
                      entry.id === book.id
                        ? {
                            ...entry,
                            cover_cache_status: "failed",
                            cover_cache_error: errorMessage,
                          }
                        : entry
                    );
                    setLocalBooks(next);
                    return next;
                  });
                  if (shouldStopRetry && book.id && !coverCacheErrorLoggedRef.current.has(book.id)) {
                    coverCacheErrorLoggedRef.current.add(book.id);
                    console.warn(
                      "[ShelfGuide] Cover cache failed; will not retry:",
                      { bookId: book.id, error: errorMessage, status: errorStatus }
                    );
                  }
                  return;
                }
                setBooks((prev) => {
                  const next = prev.map((entry) =>
                    entry.id === book.id
                      ? {
                          ...entry,
                          cover_storage_path: data.cover_storage_path,
                          cover_cache_status: "cached",
                          cover_cache_error: null,
                        }
                      : entry
                  );
                  setLocalBooks(next);
                  return next;
                });
              } finally {
                if (book.id) {
                  coverCacheInFlightRef.current.delete(book.id);
                }
              }
            })
          );
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } finally {
        coverCacheProcessingRef.current = false;
      }
    };

    void run();
  }, [books, userId]);

  useEffect(() => {
    const init = async () => {
      const userIdValue = await getAuthenticatedUserId();
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      setUserId(user?.id ?? null);
      const username = (user?.user_metadata as { username?: string })?.username;
      setUserLabel(username || user?.email || null);
      await loadBooks(userIdValue);
      await flushAllPendingSync();
    };

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserId(user?.id ?? null);
      const username = (user?.user_metadata as { username?: string })?.username;
      setUserLabel(username || user?.email || null);
      void loadBooks(user?.id ?? null);
      if (user?.id) {
        void flushAllPendingSync();
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [loadBooks]);

  // Library stats (using normalized statuses)
  const stats = useMemo(() => {
    const total = books.length;
    const statusDist: Record<string, number> = {};
    books.forEach((b) => {
      const ns = normalizeStatus(b.status);
      statusDist[ns] = (statusDist[ns] ?? 0) + 1;
    });
    if (import.meta.env.DEV) console.log("[ShelfGuide] Library status distribution:", statusDist);
    const tbr = statusDist["tbr"] ?? 0;
    const read = statusDist["finished"] ?? 0;
    const authors = new Set(books.map((b) => b.author.trim().toLowerCase())).size;
    return { total, tbr, read, authors };
  }, [books]);

  // Search + sort
  const displayedBooks = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let filtered = books;
    if (q) {
      filtered = books.filter((b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.series_name || "").toLowerCase().includes(q) ||
        b.genre.toLowerCase().includes(q)
      );
    }
    return applySort(filtered, sortMode);
  }, [books, searchQuery, sortMode]);

  const [addingBook, setAddingBook] = useState(false);
  const [addBookDialogOpen, setAddBookDialogOpen] = useState(false);

  const handleAddBook = async () => {
    const t = title.trim();
    const a = author.trim();
    if (!t || !a) {
      toast.error("Title and Author are required.");
      return;
    }
    if (!userId) {
      toast.error("Sign in to add books.");
      return;
    }
    setAddingBook(true);
    const newBook: any = {
      title: t,
      author: a,
      genre: genre.trim(),
      series_name: seriesName.trim() || null,
      is_first_in_series: isFirstInSeries,
      status,
      user_id: userId,
    };
    const { error } = await db.from("books").insert([newBook]);
    setAddingBook(false);
    if (error) {
      toast.error(`Could not add book: ${error.message}`);
      return;
    }
    toast.success(`"${t}" added to your library!`);
    setTitle(""); setAuthor(""); setGenre(""); setSeriesName(""); setIsFirstInSeries(false); setStatus("tbr");
    setAddBookDialogOpen(false);
    await loadBooks(userId);
  };

  const persistBooks = (nextBooks: LibraryBook[]) => {
    setBooks(nextBooks);
    setLocalBooks(nextBooks);
  };

  const getBookKey = (book: LibraryBook) => book.id || buildBookDedupeKey(book);

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch("/defaultBookLibrary.csv", { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Template download failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "defaultBookLibrary.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (import.meta.env.DEV) console.warn("[ShelfGuide] Template download failed:", error);
      toast.error("Could not download the CSV template. Please try again.");
    }
  };

  const handleCsvImport = async (file: File) => {
    const text = await file.text();
    const { books: parsed, diagnostics } = parseLibraryCsv(text);

    if (diagnostics.missingRequiredColumns) {
      toast.error("CSV must include 'title' and 'author' columns.");
      setImportSummary("Import failed: missing required title/author columns.");
      return;
    }

    if (parsed.length === 0) {
      const skipped = diagnostics.rejectedRows;
      toast.error(`No valid rows found. ${skipped} rows skipped.`);
      setImportSummary(`Import failed: ${skipped} rows skipped.`);
      return;
    }

    const isNonEmptyValue = (value: unknown) => {
      if (value == null) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (typeof value === "number") return Number.isFinite(value);
      if (typeof value === "boolean") return true;
      return true;
    };

    const mergeBooks = (current: LibraryBook, incoming: LibraryBook) => {
      const merged: LibraryBook = { ...current };
      const prefer = (key: keyof LibraryBook) => {
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
      prefer("rating");
      prefer("page_count");
      prefer("shelf");
      prefer("description");
      prefer("source");
      prefer("cover_url");
      prefer("thumbnail");
      prefer("cover_source");
      prefer("cover_failed_at");

      return merged;
    };

    const normalizedImported = parsed.map((book) => ({
      ...book,
      status: normalizeStatus(book.status),
      genre: book.genre || "",
    })) as LibraryBook[];

    const existingMap = new Map<string, LibraryBook>();
    books.forEach((book) => {
      existingMap.set(buildBookDedupeKey(book), book);
    });

    const importMap = new Map<string, LibraryBook>();
    let duplicateCount = 0;
    normalizedImported.forEach((book) => {
      const key = buildBookDedupeKey(book);
      const existing = importMap.get(key);
      if (!existing) {
        importMap.set(key, book);
        return;
      }
      duplicateCount += 1;
      importMap.set(key, mergeBooks(existing, book));
    });

    const dedupedImport = Array.from(importMap.values());
    const mergedLocal = [...books];
    const dedupeKeySet = new Set<string>();

    dedupedImport.forEach((book) => {
      const key = buildBookDedupeKey(book);
      dedupeKeySet.add(key);
      const existing = existingMap.get(key);
      if (existing) {
        const merged = mergeBooks(existing, book);
        const idx = mergedLocal.findIndex((entry) => buildBookDedupeKey(entry) === key);
        if (idx >= 0) mergedLocal[idx] = merged;
        return;
      }
      mergedLocal.push(book);
    });

    const dedupeKeys = Array.from(dedupeKeySet.values());

    const fetchExistingKeys = async (keys: string[]) => {
      const existing = new Set<string>();
      const chunkSize = 200;
      for (let i = 0; i < keys.length; i += chunkSize) {
        const chunk = keys.slice(i, i + chunkSize);
        const { data, error } = await db
          .from("books")
          .select("dedupe_key")
          .eq("user_id", userId)
          .in("dedupe_key", chunk);
        if (error) {
          if (import.meta.env.DEV) {
            console.warn("[ShelfGuide] CSV import lookup failed:", error);
          }
          break;
        }
        (data || []).forEach((row: { dedupe_key?: string | null }) => {
          if (row?.dedupe_key) existing.add(row.dedupe_key);
        });
      }
      return existing;
    };

    let insertCount = 0;
    let updateCount = 0;

    if (userId) {
      const existingKeys = await fetchExistingKeys(dedupeKeys);
      updateCount = existingKeys.size;
      insertCount = Math.max(0, dedupeKeys.length - updateCount);

      const { error } = await upsertBooksToCloud(userId, dedupedImport);
      if (error) {
        console.error("[ShelfGuide] CSV import upsert error:", error);
        const syncError = await recordSyncError({ error, operation: "upsert", table: "books", userId });
        toast.error(syncError.userMessage || "Import failed. Books saved locally.");
        persistBooks(mergedLocal);
      } else {
        await loadBooks(userId);
      }
    } else {
      persistBooks(mergedLocal);
    }

    const booksWithCovers = dedupedImport.filter((b) => b.cover_url || b.thumbnail).length;
    const missingCovers = dedupedImport.length - booksWithCovers;

    const parts = [
      `Parsed ${diagnostics.totalRows} row(s).`,
      `Accepted ${diagnostics.acceptedRows}.`,
    ];
    if (diagnostics.rejectedRows > 0) {
      parts.push(`Rejected ${diagnostics.rejectedRows}.`);
    }
    parts.push(`Imported ${dedupedImport.length} unique book(s).`);
    if (userId) {
      parts.push(`Inserted ${insertCount}, updated ${updateCount}.`);
    }
    if (booksWithCovers > 0) parts.push(`Covers found for ${booksWithCovers}.`);
    if (missingCovers > 0) parts.push(`Missing covers: ${missingCovers} (will fetch async).`);
    if (duplicateCount > 0) parts.push(`${duplicateCount} duplicates in file merged.`);

    if (diagnostics.rejectedRows > 0) {
      const reasonBuckets = Object.entries(diagnostics.rejectedByReason)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(", ");
      if (reasonBuckets) {
        parts.push(`Reject reasons: ${reasonBuckets}.`);
      }
    }

    const summary = parts.join(" ");
    if (import.meta.env.DEV) {
      console.log("[ShelfGuide] CSV import summary:", summary);
    }
    setImportSummary(summary);
    toast.success("Import complete. See summary below.");
  };

  const withRetryParam = (url: string, token?: number) => {
    if (!token) return url;
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}retry=${token}`;
  };

  const setBookCover = (bookId: string, coverUrl: string) => {
    setBooks((prev) => {
      const next = prev.map((entry) =>
        entry.id === bookId
          ? {
              ...entry,
              cover_url: coverUrl,
              thumbnail: coverUrl,
              cover_source: "google_books",
              cover_failed_at: null,
              cover_cache_status: null,
              cover_cache_error: null,
            }
          : entry
      );
      setLocalBooks(next);
      return next;
    });
  };

  const setBookCoverByKey = (book: LibraryBook, coverUrl: string) => {
    const targetKey = buildBookDedupeKey(book);
    setBooks((prev) => {
      const next = prev.map((entry) =>
        buildBookDedupeKey(entry) === targetKey
          ? {
              ...entry,
              cover_url: coverUrl,
              thumbnail: coverUrl,
              cover_source: "google_books",
              cover_failed_at: null,
              cover_cache_status: null,
              cover_cache_error: null,
            }
          : entry
      );
      setLocalBooks(next);
      return next;
    });
  };

  const isMissingCover = (book: LibraryBook) => {
    const hasCover =
      !!book.cover_url ||
      !!book.thumbnail ||
      !!book.cover_storage_path;
    return !hasCover;
  };

  const withBackoffRetry = async <T,>(fn: () => Promise<T>, retries = 1, baseDelayMs = 500) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const message = String(err?.message || err || "");
        const status = err?.status || err?.statusCode || null;
        const shouldRetry = status === 429 || /timeout|timed out|rate limit|too many/i.test(message);
        if (!shouldRetry || attempt >= retries) break;
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  };

  const refreshMissingCovers = async () => {
    if (refreshingCovers) return;
    setRefreshingCovers(true);

    const missing = books.filter(isMissingCover);
    if (missing.length === 0) {
      setRefreshingCovers(false);
      toast.message("All books already have covers.");
      return;
    }

    const concurrency = 4;
    const batchSize = 12;
    let updatedCount = 0;
    let stillMissing = 0;

    const processBatch = async (batch: LibraryBook[]) => {
      let cursor = 0;
      const runWorker = async () => {
        while (cursor < batch.length) {
          const current = batch[cursor];
          cursor += 1;
          try {
            const foundCover = await withBackoffRetry(
              () =>
                lookupCoverForBook({
                  title: current.title,
                  author: current.author,
                  isbn: current.isbn ?? null,
                  isbn13: current.isbn13 ?? null,
                }),
              1,
              650
            );
            if (!foundCover) {
              stillMissing += 1;
              continue;
            }
            updatedCount += 1;

            if (current.id) setBookCover(current.id, foundCover);
            else setBookCoverByKey(current, foundCover);

            if (userId && current.id) {
              const { error } = await db
                .from("books")
                .update({
                  cover_url: foundCover,
                  thumbnail: foundCover,
                  cover_source: "google_books",
                  cover_failed_at: null,
                  cover_cache_status: null,
                  cover_cache_error: null,
                })
                .eq("id", current.id);
              if (error && import.meta.env.DEV) {
                console.warn("[ShelfGuide] Refresh missing covers update failed:", error);
              }
            }
          } catch (err) {
            stillMissing += 1;
            if (import.meta.env.DEV) {
              console.warn("[ShelfGuide] Refresh missing covers lookup failed:", err);
            }
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, batch.length) }, () => runWorker());
      await Promise.all(workers);
    };

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      await processBatch(batch);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    setRefreshingCovers(false);
    toast.success(`Updated ${updatedCount} covers. ${stillMissing} still missing.`);
  };

  const updateBookStatus = async (book: LibraryBook, nextStatus: string) => {
    const key = getBookKey(book);
    const updated = { ...book, status: nextStatus };
    setBooks((prev) => {
      const next = prev.map((b) => (getBookKey(b) === key ? updated : b));
      setLocalBooks(next);
      return next;
    });
    setSavingStatuses((prev) => ({ ...prev, [key]: true }));

    if (userId && book.id) {
      const { error } = await db.from("books").update({ status: nextStatus }).eq("id", book.id);
      setSavingStatuses((prev) => ({ ...prev, [key]: false }));
      if (error) {
        await recordSyncError({ error, operation: "update", table: "books", userId });
        toast.error("Could not update status. Saved locally and queued for retry.");
        enqueueLibrarySync(userId, [{ ...book, status: nextStatus }], "status_update");
        return;
      }
      toast.success("Status updated.");
      return;
    }

    setSavingStatuses((prev) => ({ ...prev, [key]: false }));
    if (!userId) return;

    // If we do not have a book id while signed in, queue the change.
    enqueueLibrarySync(userId, [{ ...book, status: nextStatus }], "status_update");
  };

  const updateBookRating = async (book: LibraryBook, nextRating: number | null) => {
    const key = getBookKey(book);
    const updated = { ...book, rating: nextRating };
    setBooks((prev) => {
      const next = prev.map((b) => (getBookKey(b) === key ? updated : b));
      setLocalBooks(next);
      return next;
    });
    setSavingRatings((prev) => ({ ...prev, [key]: true }));

    if (userId && book.id) {
      const { error } = await db.from("books").update({ rating: nextRating }).eq("id", book.id);
      setSavingRatings((prev) => ({ ...prev, [key]: false }));
      if (error) {
        await recordSyncError({ error, operation: "update", table: "books", userId });
        toast.error("Could not update rating. Saved locally and queued for retry.");
        const payload = { ...book, rating: nextRating, explicit_nulls: nextRating == null ? (["rating"] as Array<"rating">) : undefined };
        enqueueLibrarySync(userId, [payload], "rating_update");
        return;
      }
      toast.success("Rating saved.");
      return;
    }

    setSavingRatings((prev) => ({ ...prev, [key]: false }));
    if (!userId) return;
    const payload = { ...book, rating: nextRating, explicit_nulls: nextRating == null ? (["rating"] as Array<"rating">) : undefined };
    enqueueLibrarySync(userId, [payload], "rating_update");
  };

  const startEditing = (index: number) => {
    const book = displayedBooks[index];
    if (!book) return;
    const realIndex = books.indexOf(book);
    setEditingIndex(realIndex);
    setEditTitle(book.title);
    setEditAuthor(book.author);
    setEditGenre(book.genre);
    setEditSeriesName(book.series_name ?? "");
    setEditIsFirstInSeries(book.is_first_in_series);
    setEditStatus(book.status || "tbr");
  };

  const saveEdits = () => {
    if (editingIndex === null) return;
    const updatedBook = {
      title: editTitle.trim(),
      author: editAuthor.trim(),
      genre: editGenre.trim(),
      series_name: editSeriesName.trim() || null,
      is_first_in_series: editIsFirstInSeries,
      status: editStatus,
    };
    const target = books[editingIndex];
    const merged = target ? { ...target, ...updatedBook, id: target.id } : { ...updatedBook, id: target?.id };

    if (userId && target?.id) {
      (async () => {
        const { dedupe_key: _dk, created_at: _ca, updated_at: _ua, ...cleanUpdate } = updatedBook as any;
        const { error } = await db
          .from("books")
          .update(cleanUpdate)
          .eq("id", target.id);
        if (error) {
          await recordSyncError({ error, operation: "update", table: "books", userId });
          toast.error("Could not update book. Please retry.");
          return;
        }
        const nextBooks = [...books];
        nextBooks[editingIndex] = merged;
        setBooks(nextBooks);
        setEditingIndex(null);
        toast.success("Book updated.");
      })();
      return;
    }

    const nextBooks = [...books];
    nextBooks[editingIndex] = merged;
    persistBooks(nextBooks);
    setEditingIndex(null);
    toast.success("Book updated.");
  };

  const deleteBook = (displayIndex: number) => {
    const book = displayedBooks[displayIndex];
    if (!book) return;
    const realIndex = books.indexOf(book);
    if (userId && book.id) {
      (async () => {
        const { error } = await db
          .from("books")
          .delete()
          .eq("id", book.id);
        if (error) {
          await recordSyncError({ error, operation: "delete", table: "books", userId });
          toast.error("Could not delete book. Please retry.");
          return;
        }
        const nextBooks = books.filter((_, i) => i !== realIndex);
        setBooks(nextBooks);
        toast.success("Book removed.");
      })();
      return;
    }
    const nextBooks = books.filter((_, i) => i !== realIndex);
    persistBooks(nextBooks);
    toast.success("Book removed.");
  };


  /** Manual retry for cloud sync */
  const retryCloudSync = async () => {
    if (!userId) return;
    if (import.meta.env.DEV) console.log("[ShelfGuide] Manual cloud sync retry triggered");
    await loadBooks(userId);
    await flushAllPendingSync();
  };

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-4xl font-bold">My Library</h1>
          <p className="text-muted-foreground mt-2 font-body">
            Your personal book collection
          </p>
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={() => void handleDownloadTemplate()}>
              Download CSV Template
            </Button>
          </div>
        </div>
        <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 flex-wrap">
          {userLabel && (
            <span className="text-xs text-muted-foreground font-body order-first sm:order-none">
              Signed in as {userLabel}
            </span>
          )}
          <div className="flex items-center gap-2">
            <Dialog open={addBookDialogOpen} onOpenChange={setAddBookDialogOpen}>
              <DialogTrigger asChild>
                <Button>Add Book</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl border border-border/60 bg-card/95 p-0">
                <div className="rounded-2xl overflow-hidden">
                  <div className="px-8 py-6 bg-secondary/40 border-b border-border/60">
                    <DialogHeader>
                      <DialogTitle className="font-display text-2xl">
                        Library Card
                      </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground font-body mt-2">
                      Fill in the card to add another book to your library.
                    </p>
                  </div>

                  <div className="px-8 py-6 grid gap-5">
                    <div className="grid gap-2">
                      <Label htmlFor="book-title">Title <span className="text-destructive">*</span></Label>
                      <Input id="book-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Name of the Wind" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="book-author">Author <span className="text-destructive">*</span></Label>
                      <Input id="book-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Patrick Rothfuss" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="book-genre">Genre</Label>
                      <Input id="book-genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Fantasy" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="book-series">Series Name</Label>
                      <Input id="book-series" value={seriesName} onChange={(e) => setSeriesName(e.target.value)} placeholder="The Kingkiller Chronicle" />
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="book-first" checked={isFirstInSeries} onCheckedChange={(checked) => setIsFirstInSeries(checked === true)} />
                      <Label htmlFor="book-first">Is first in series</Label>
                    </div>
                    <div className="grid gap-2">
                      <Label>Status</Label>
                      <Select value={status} onValueChange={setStatus}>
                        <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tbr">TBR</SelectItem>
                          <SelectItem value="reading">Reading</SelectItem>
                          <SelectItem value="finished">Finished</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-end gap-3">
                      <Button variant="outline" onClick={() => setAddBookDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleAddBook} disabled={addingBook || !userId}>
                        {addingBook ? "Adding..." : "Add Book"}
                      </Button>
                    </div>
                    {!userId && (
                      <p className="text-xs text-muted-foreground text-center">Sign in to add books.</p>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleCsvImport(file);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="text-xs px-3 h-8"
              onClick={() => csvInputRef.current?.click()}
            >
              Import Library
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs px-3 h-8 gap-1"
              onClick={() => setScannerOpen(true)}
            >
              <Camera className="w-3 h-3" /> Scan Book
            </Button>
          </div>
        </div>
      </div>

      {cloudNotice && (
        <div className="mb-4 rounded-lg border border-border/60 bg-card/60 px-4 py-2 text-xs text-muted-foreground">
          <span>{cloudNotice}</span>
        </div>
      )}
      {importSummary && (
        <div className="mb-4 rounded-lg border border-border/60 bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
          <span>{importSummary}</span>
        </div>
      )}

      {/* Stats banner */}
      {books.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-card/70 px-5 py-3 text-sm font-body">
          <span><strong>{stats.total}</strong> books</span>
          <span className="text-muted-foreground">|</span>
          <span><strong>{stats.tbr}</strong> TBR</span>
          <span className="text-muted-foreground">|</span>
          <span><strong>{stats.read}</strong> Finished</span>
          <span className="text-muted-foreground">|</span>
          <span><strong>{stats.authors}</strong> authors</span>
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8"
              onClick={() => void refreshMissingCovers()}
              disabled={refreshingCovers}
            >
              {refreshingCovers ? "Refreshing..." : "Refresh Missing Covers"}
            </Button>
          </div>
        </div>
      )}

      {/* Search + Sort controls */}
      {books.length > 0 && (
        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search by title, author, series, or genre..."
            className="flex-1"
          />
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title_az">Title A→Z</SelectItem>
              <SelectItem value="author_az">Author A→Z</SelectItem>
              <SelectItem value="genre_az">Genre A→Z</SelectItem>
              <SelectItem value="series_first">Series first</SelectItem>
              <SelectItem value="author_series">Author + Series together</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {displayedBooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookMarked className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h2 className="font-display text-2xl font-bold mb-2">
            {loadingBooks ? "Loading library..." : searchQuery ? "No matches found" : "No books yet"}
          </h2>
          <p className="text-muted-foreground max-w-md font-body">
            {searchQuery ? "Try a different search term." : "Start building your library by adding books you've read, are reading, or want to read."}
          </p>
        </div>
      ) : (
        <BookGrid>
          {displayedBooks.map((book, index) => {
            const bookKey = getBookKey(book);
            const normalizedStatus = normalizeStatus(book.status);
            const coverKey = book.title + "|" + book.author;
            const coverFailed = failedCovers.has(coverKey);
            const coverSrc = book.cover_url || book.thumbnail;
            const retryToken = book.id ? coverRetryTokens[book.id] : undefined;
            const coverSrcWithRetry = coverSrc ? withRetryParam(coverSrc, retryToken) : null;
            const showRetry = !coverSrcWithRetry || coverFailed;
            return (
              <BookCard
                key={book.id || `${buildBookDedupeKey(book)}-${index}`}
                book={book}
                coverSrc={coverSrcWithRetry}
                coverFailed={coverFailed}
                onCoverError={() => {
                  let shouldPersistFailure = false;
                  setFailedCovers((prev) => {
                    if (prev.has(coverKey)) return prev;
                    shouldPersistFailure = true;
                    console.warn(`[ShelfGuide] Cover load failed for book id=${book.id || "unknown"} url=${coverSrc}`);
                    return new Set(prev).add(coverKey);
                  });
                  if (userId) {
                    if (!shouldPersistFailure) return;
                    void db
                      .from("books")
                      .update({ cover_failed_at: new Date().toISOString() })
                      .eq("id", book.id || "");
                  }
                }}
                onRetryCover={
                  book.id && showRetry
                    ? async () => {
                        if (!book.id) return;
                        if (coverRetrying[book.id]) return;
                        setCoverRetrying((prev) => ({ ...prev, [book.id as string]: true }));
                        clearCoverCacheForBook({
                          title: book.title,
                          author: book.author,
                          isbn: book.isbn ?? null,
                          isbn13: book.isbn13 ?? null,
                        });
                        try {
                          const foundCover = await lookupCoverForBook({
                            title: book.title,
                            author: book.author,
                            isbn: book.isbn ?? null,
                            isbn13: book.isbn13 ?? null,
                          });
                          if (!foundCover) {
                            toast.error("Couldn't load cover. Try again.");
                            return;
                          }

                          setBookCover(book.id, foundCover);

                          if (userId) {
                            const { error } = await db
                              .from("books")
                              .update({
                                cover_url: foundCover,
                                thumbnail: foundCover,
                                cover_source: "google_books",
                                cover_failed_at: null,
                                cover_cache_status: null,
                                cover_cache_error: null,
                              })
                              .eq("id", book.id);
                            if (error && import.meta.env.DEV) {
                              console.warn("[ShelfGuide] Cover update failed:", error);
                            }
                          }

                          setCoverRetryTokens((prev) => ({
                            ...prev,
                            [book.id as string]: Date.now(),
                          }));
                          setFailedCovers((prev) => {
                            const next = new Set(prev);
                            next.delete(coverKey);
                            return next;
                          });
                          toast.success("Cover updated.");
                        } finally {
                          setCoverRetrying((prev) => ({ ...prev, [book.id as string]: false }));
                        }
                      }
                    : undefined
                }
                retrying={book.id ? coverRetrying[book.id] === true : false}
                statusNode={
                  <>
                    <StatusSelector
                      value={normalizedStatus}
                      onChange={(next) => updateBookStatus(book, next)}
                      disabled={!!savingStatuses[bookKey]}
                    />
                    {savingStatuses[bookKey] && (
                      <span className="text-[10px] text-muted-foreground">Saving...</span>
                    )}
                  </>
                }
                actionsNode={
                  <>
                    <Button variant="outline" size="sm" onClick={() => startEditing(index)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteBook(index)}>Delete</Button>
                  </>
                }
                ratingNode={
                  <StarRating
                    value={book.rating ?? null}
                    onChange={(next) => updateBookRating(book, next)}
                    saving={!!savingRatings[bookKey]}
                  />
                }
                badgesNode={
                  <>
                    {book.genre && <span className="rounded-full bg-secondary/70 px-2 py-0.5">{book.genre}</span>}
                    {book.series_name && <span className="rounded-full bg-secondary/70 px-2 py-0.5">{book.series_name}</span>}
                    {book.id && (
                      <BookNotes
                        bookId={book.id}
                        initialComment={book.user_comment ?? null}
                        userId={userId}
                      />
                    )}
                  </>
                }
              />
            );
          })}
        </BookGrid>
      )}

      <Dialog open={editingIndex !== null} onOpenChange={(open) => !open && setEditingIndex(null)}>
        <DialogContent className="max-w-2xl border border-border/60 bg-card/95 p-0">
          <div className="rounded-2xl overflow-hidden">
            <div className="px-8 py-6 bg-secondary/40 border-b border-border/60">
              <DialogHeader>
                <DialogTitle className="font-display text-2xl">Edit Library Card</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground font-body mt-2">Update details for this book.</p>
            </div>
            <div className="px-8 py-6 grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="edit-title">Title</Label>
                <Input id="edit-title" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-author">Author</Label>
                <Input id="edit-author" value={editAuthor} onChange={(e) => setEditAuthor(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-genre">Genre</Label>
                <Input id="edit-genre" value={editGenre} onChange={(e) => setEditGenre(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-series">Series Name</Label>
                <Input id="edit-series" value={editSeriesName} onChange={(e) => setEditSeriesName(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="edit-first" checked={editIsFirstInSeries} onCheckedChange={(checked) => setEditIsFirstInSeries(checked === true)} />
                <Label htmlFor="edit-first">Is first in series</Label>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tbr">TBR</SelectItem>
                    <SelectItem value="reading">Reading</SelectItem>
                    <SelectItem value="finished">Finished</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-end gap-3">
                <Button variant="outline" onClick={() => setEditingIndex(null)}>Cancel</Button>
                <Button onClick={saveEdits}>Save Changes</Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <BookScanner
        open={scannerOpen}
        onOpenChange={setScannerOpen}
        existingIsbns={existingIsbns}
        onBookScanned={async (scanned) => {
          if (!userId) {
            toast.error("Sign in to add books.");
            return;
          }
          // Check dedupe
          const normalizedIsbn = scanned.isbn13 || scanned.isbn;
          if (normalizedIsbn && existingIsbns.has(normalizedIsbn.replace(/[^0-9xX]/g, ""))) {
            toast.info("This book is already in your library.");
            return;
          }
          // Pre-fill and insert
          const newBook: any = {
            title: scanned.title,
            author: scanned.author,
            genre: scanned.genre || "",
            series_name: null,
            is_first_in_series: false,
            status: "tbr",
            isbn: scanned.isbn || null,
            isbn13: scanned.isbn13 || null,
            description: scanned.description || null,
            page_count: scanned.page_count,
            published_year: scanned.published_year,
            thumbnail: scanned.thumbnail || null,
            cover_url: scanned.thumbnail || null,
            user_id: userId,
          };
          setAddBookDialogOpen(true);
          setTitle(scanned.title);
          setAuthor(scanned.author);
          setGenre(scanned.genre || "");
          setStatus("tbr");
          toast.success(`Found "${scanned.title}" — review and save.`);
        }}
      />
    </main>
  );
};

export default Library;


