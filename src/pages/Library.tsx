import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, BookOpen, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import StarRating from "@/components/StarRating";
import StatusSelector from "@/components/StatusSelector";
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
import { buildBookDedupeKey, normalizeDedupeValue } from "@/lib/bookDedupe";
import { applySort, type SortMode } from "@/lib/librarySort";
import { clearCoverCacheForBook, enrichCovers } from "@/lib/coverEnrichment";

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
  cover_source?: string | null;
  cover_failed_at?: string | null;
  source?: string | null;
};

type ImportSummary = {
  fileName: string;
  rowsRead: number;
  created: number;
  updated: number;
  skipped: number;
  merged: number;
  errors: number;
};

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [defaultImporting, setDefaultImporting] = useState(false);
  const [defaultImportProgress, setDefaultImportProgress] = useState<string | null>(null);
  const [defaultImportSummary, setDefaultImportSummary] = useState<ImportSummary | null>(null);
  const [enrichOnImport, setEnrichOnImport] = useState(true);
  const [importLogs, setImportLogs] = useState<
    {
      id: string;
      source: string;
      added_count: number;
      updated_count: number;
      failed_count: number;
      failures: string[] | null;
      created_at: string;
    }[]
  >([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [confirmClearLogs, setConfirmClearLogs] = useState(false);
  const [selectedFailures, setSelectedFailures] = useState<string[] | null>(null);
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("title_az");
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());
  const [savingRatings, setSavingRatings] = useState<Record<string, boolean>>({});
  const [savingStatuses, setSavingStatuses] = useState<Record<string, boolean>>({});

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

  const loadImportLogs = useCallback(async (userIdValue: string | null) => {
    if (!userIdValue) {
      setImportLogs([]);
      return;
    }
    setLoadingLogs(true);
    const { data, error } = await db
      .from("import_logs")
      .select("id,source,added_count,updated_count,failed_count,failures,created_at")
      .eq("user_id", userIdValue)
      .order("created_at", { ascending: false })
      .limit(6);
    setLoadingLogs(false);
    if (error) {
      // import_logs table may not exist - don't show sync banner for this
      if (import.meta.env.DEV) console.warn("[ShelfGuide] loadImportLogs error (non-critical):", error.message);
      return;
    }
    setImportLogs(data || []);
  }, []);

  const clearImportLogs = async () => {
    if (!userId) {
      setImportLogs([]);
      return;
    }
    const { error } = await db
      .from("import_logs")
      .delete()
      .eq("user_id", userId);
    if (error) {
      toast.error("Could not clear import history.");
      return;
    }
    setImportLogs([]);
    toast.success("Import history cleared.");
  };

  useEffect(() => {
    if (!confirmClearLogs) return;
    const timer = setTimeout(() => setConfirmClearLogs(false), 8000);
    return () => clearTimeout(timer);
  }, [confirmClearLogs]);

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
      setCloudNotice(syncError.userMessage || `Cloud sync is unavailable - ${reason.toLowerCase()}. Using local-only data for now.`);
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
        .insert(localBooks.map((book: LibraryBook) => ({ ...book, user_id: userIdValue })));
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
    const init = async () => {
      const userIdValue = await getAuthenticatedUserId();
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      setUserId(user?.id ?? null);
      const username = (user?.user_metadata as { username?: string })?.username;
      setUserLabel(username || user?.email || null);
      await loadBooks(userIdValue);
      await loadImportLogs(userIdValue);
      await flushAllPendingSync();
    };

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserId(user?.id ?? null);
      const username = (user?.user_metadata as { username?: string })?.username;
      setUserLabel(username || user?.email || null);
      void loadBooks(user?.id ?? null);
      void loadImportLogs(user?.id ?? null);
      if (user?.id) {
        void flushAllPendingSync();
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [loadBooks, loadImportLogs]);

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

  const codeSnippet = useMemo(() => {
    const payload = {
      title: title.trim(),
      author: author.trim(),
      genre: genre.trim(),
      series_name: seriesName.trim() || null,
      is_first_in_series: isFirstInSeries,
      status,
    };

    return `{\n  "title": "${payload.title}",\n  "author": "${payload.author}",\n  "genre": "${payload.genre}",\n  "series_name": ${payload.series_name ? `"${payload.series_name}"` : "null"},\n  "is_first_in_series": ${payload.is_first_in_series},\n  "status": "${payload.status}"\n}`;
  }, [title, author, genre, seriesName, isFirstInSeries, status]);

  const persistBooks = (nextBooks: LibraryBook[]) => {
    setBooks(nextBooks);
    setLocalBooks(nextBooks);
  };

  const getBookKey = (book: LibraryBook) => book.id || buildBookDedupeKey(book);

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
        const payload = { ...book, rating: nextRating, explicit_nulls: nextRating == null ? ["rating"] : undefined };
        enqueueLibrarySync(userId, [payload], "rating_update");
        return;
      }
      toast.success("Rating saved.");
      return;
    }

    setSavingRatings((prev) => ({ ...prev, [key]: false }));
    if (!userId) return;
    const payload = { ...book, rating: nextRating, explicit_nulls: nextRating == null ? ["rating"] : undefined };
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
        const { error } = await db
          .from("books")
          .update(updatedBook)
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

  const normalizeHeader = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_");

  const DEFAULT_CSV_HEADERS = [
    "library_id",
    "title",
    "author",
    "genre",
    "series_name",
    "is_first_in_series",
    "status",
  ];

  const REQUIRED_DEFAULT_HEADERS = ["library_id", "title", "author"];

  const parseBooleanish = (value: string | null | undefined): boolean => {
    const raw = (value || "").trim().toLowerCase();
    if (!raw) return false;
    if (["1", "1.0", "true", "yes", "y"].includes(raw)) return true;
    if (["0", "0.0", "false", "no", "n"].includes(raw)) return false;
    return false;
  };

  const parseDefaultLibraryId = (value: string | null | undefined): number | null => {
    const raw = (value || "").trim();
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
  };

  const stripGoodreadsIsbn = (raw: string) => {
    return raw.replace(/^="?|"$/g, "").replace(/[^0-9xX]/g, "").trim();
  };

  const mapShelfToStatus = (shelf: string | null | undefined, bookshelves: string | null | undefined) => {
    const normalized = normalizeDedupeValue(shelf || "");
    if (normalized === "to-read") return "tbr";
    if (normalized === "currently-reading") return "reading";
    if (normalized === "read") return "finished";
    const normalizedShelves = normalizeDedupeValue(bookshelves || "");
    if (normalizedShelves.includes("currently-reading")) return "reading";
    if (normalizedShelves.includes("read")) return "finished";
    if (normalizedShelves.includes("to-read")) return "tbr";
    return "tbr";
  };

  const parseGoodreadsDate = (value: string | null | undefined): string | null => {
    const raw = (value || "").trim();
    if (!raw) return null;
    const asDate = new Date(raw);
    if (Number.isNaN(asDate.getTime())) return null;
    return asDate.toISOString().slice(0, 10);
  };

  const parsePublishedYear = (value: string | null | undefined): number | null => {
    const raw = (value || "").trim();
    if (!raw) return null;
    const year = Number(raw);
    if (!Number.isFinite(year)) return null;
    if (year < 0 || year > 9999) return null;
    return Math.trunc(year);
  };

  const hasGoodreadsHeaders = (headers: string[]) => {
    const set = new Set(headers);
    return set.has("title") && set.has("author");
  };

  const parseCsv = (text: string) => {
    const rows: string[][] = [];
    let current = "";
    let inQuotes = false;
    const row: string[] = [];

    const pushCell = () => {
      row.push(current);
      current = "";
    };

    const pushRow = () => {
      if (row.length > 0 || current.length > 0) {
        pushCell();
        rows.push([...row]);
        row.length = 0;
      }
    };

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && char === ",") {
        pushCell();
        continue;
      }

      if (!inQuotes && (char === "\n" || char === "\r")) {
        if (char === "\r" && next === "\n") {
          i += 1;
        }
        pushRow();
        continue;
      }

      current += char;
    }

    pushRow();
    return rows;
  };

  const handleLibraryUpload = async (file: File) => {
    setDefaultImportSummary(null);
    setDefaultImportProgress("Reading CSV file...");
    setDefaultImporting(true);

    try {
      const text = await file.text();
      const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length));
      if (rows.length < 2) {
        toast.error("CSV is empty or missing rows.");
        setDefaultImportProgress(null);
        return;
      }

      const headers = rows[0].map(normalizeHeader);
      const missingHeaders = REQUIRED_DEFAULT_HEADERS.filter((header) => !headers.includes(header));
      if (missingHeaders.length > 0) {
        toast.error(
          `Missing required headers: ${missingHeaders.join(", ")}. Expected: ${DEFAULT_CSV_HEADERS.join(", ")}.`
        );
        setDefaultImportProgress(null);
        return;
      }

      const dataRows = rows.slice(1);
      const rowsRead = dataRows.length;
      const failures: string[] = [];
      let skipped = 0;
      let merged = 0;
      let created = 0;
      let updated = 0;

      const incomingMap = new Map<string, LibraryBook>();
      dataRows.forEach((row, index) => {
        const record: Record<string, string> = {};
        headers.forEach((header, colIndex) => {
          record[header] = (row[colIndex] || "").trim();
        });

        const titleValue = record.title?.trim() || "";
        const authorValue = record.author?.trim() || "";
        const defaultId = parseDefaultLibraryId(record.library_id);
        if (defaultId == null) {
          skipped += 1;
          failures.push(`Row ${index + 2}: missing or invalid library_id.`);
          return;
        }
        if (!titleValue || !authorValue) {
          skipped += 1;
          failures.push(`Row ${index + 2}: missing title or author.`);
          return;
        }

        const book: LibraryBook = {
          title: titleValue,
          author: authorValue,
          genre: record.genre?.trim() || "",
          series_name: record.series_name?.trim() || null,
          is_first_in_series: parseBooleanish(record.is_first_in_series),
          status: normalizeStatus(record.status || "tbr"),
          default_library_id: defaultId,
          source: "default_csv",
        };

        const key = buildBookDedupeKey(book);
        if (incomingMap.has(key)) {
          merged += 1;
        }
        incomingMap.set(key, book);
      });

      if (!incomingMap.size) {
        toast.error("No valid rows found. Ensure library_id, title, and author are present.");
        setDefaultImportProgress(null);
        setDefaultImportSummary({
          fileName: file.name,
          rowsRead,
          created,
          updated,
          skipped,
          merged,
          errors: failures.length,
        });
        return;
      }

      const existing = books;
      const indexByKey = new Map<string, number>();
      const nextBooks = [...existing];
      existing.forEach((book, index) => {
        indexByKey.set(buildBookDedupeKey(book), index);
      });

      const upserts: LibraryBook[] = [];
      incomingMap.forEach((incoming) => {
        const key = buildBookDedupeKey(incoming);
        const existingIndex = indexByKey.get(key);
        if (typeof existingIndex !== "number") {
          created += 1;
          upserts.push(incoming);
          indexByKey.set(key, nextBooks.length);
          nextBooks.push(incoming);
          return;
        }

        updated += 1;
        const current = nextBooks[existingIndex];
        const mergedBook: LibraryBook = {
          ...current,
          ...incoming,
          id: current?.id,
          rating: current?.rating ?? incoming.rating ?? null,
          cover_url: current?.cover_url || current?.thumbnail || incoming.cover_url || incoming.thumbnail || null,
          thumbnail: current?.cover_url || current?.thumbnail || incoming.cover_url || incoming.thumbnail || null,
          cover_source: current?.cover_source || incoming.cover_source || null,
          cover_failed_at: current?.cover_failed_at || incoming.cover_failed_at || null,
          source: current?.source || incoming.source,
        };
        nextBooks[existingIndex] = mergedBook;
        upserts.push(mergedBook);
      });

      persistBooks(nextBooks);

      const summary = {
        fileName: file.name,
        rowsRead,
        created,
        updated,
        skipped,
        merged,
        errors: failures.length,
      };
      setDefaultImportSummary(summary);
      setDefaultImportProgress(null);

      if (userId) {
        const userIdValue = await getAuthenticatedUserId();
        if (!userIdValue) {
          setCloudNotice("Not signed in. Saved locally only.");
          toast.success(
            `Import complete. Rows: ${summary.rowsRead}, created: ${summary.created}, updated: ${summary.updated}, skipped: ${summary.skipped}, merged: ${summary.merged}, errors: ${summary.errors}.`
          );
          return;
        }

        enqueueLibrarySync(userIdValue, upserts, "default_csv_upload", file.name);
        setCloudNotice(`Syncing ${upserts.length} items...`);
        const syncResult = await flushAllPendingSync();
        if (syncResult.failed > 0) {
          setCloudNotice("Cloud sync pending. We will retry automatically.");
          toast.error(syncResult.errorMessages[0] || "Cloud sync failed. Using local-only data for now.");
          return;
        }
        await loadBooks(userIdValue);
        setCloudNotice(null);
      }

      toast.success(
        `Import complete. Rows: ${summary.rowsRead}, created: ${summary.created}, updated: ${summary.updated}, skipped: ${summary.skipped}, merged: ${summary.merged}, errors: ${summary.errors}.`
      );
    } finally {
      setDefaultImporting(false);
    }
  };

  const handleGoodreadsImport = async (file: File) => {
    toast.message("Goodreads import is coming soon. This preview may change.");
    const userIdValue = await getAuthenticatedUserId();
    if (!userIdValue) {
      toast.error("Sign in to import Goodreads data into your cloud library.");
      return;
    }

    setImportSummary(null);
    setImportProgress("Reading CSV file...");

    const text = await file.text();
    const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length));
    if (rows.length < 2) {
      toast.error("CSV is empty or missing rows.");
      setImportProgress(null);
      return;
    }

    const headers = rows[0].map(normalizeHeader);
    if (!hasGoodreadsHeaders(headers)) {
      toast.error(
        "Invalid Goodreads CSV header. Required columns: Title and Author. Optional: ISBN, ISBN13, Year Published, Exclusive Shelf, Bookshelves, Date Read, Date Added, My Rating."
      );
      setImportProgress(null);
      return;
    }

    const dataRows = rows.slice(1);
    const rowsRead = dataRows.length;
    const failures: string[] = [];
    let skipped = 0;

    const records = dataRows.map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = (row[index] || "").trim();
      });
      return record;
    });

    const parsed = records
      .map((record, index) => {
        const bookTitle = record.title?.trim() || "";
        const bookAuthor = record.author?.trim() || "";
        if (!bookTitle || !bookAuthor) {
          skipped += 1;
          failures.push(`Row ${index + 2}: missing Title or Author.`);
          return null;
        }

        const shelf = record.exclusive_shelf || record.shelf || "";
        const bookshelves = record.bookshelves || "";
        const bookStatus = mapShelfToStatus(shelf, bookshelves);
        const isbn = stripGoodreadsIsbn(record.isbn || "");
        const isbn13 = stripGoodreadsIsbn(record.isbn13 || "");
        const goodreadsBookId = (record.book_id || "").trim();
        const rawRating = record.my_rating ? Number(record.my_rating) : null;
        const rating =
          Number.isFinite(rawRating) && rawRating >= 1 && rawRating <= 5
            ? Math.trunc(rawRating)
          : null;
        const publishedYear = parsePublishedYear(
          record.year_published || record.original_publication_year || ""
        );
        const dateRead = parseGoodreadsDate(record.date_read || null);

        return {
          title: bookTitle,
          author: bookAuthor,
          genre: record.genre?.trim() || "",
          series_name: record.series_name?.trim() || null,
          is_first_in_series: false,
          status: bookStatus,
          isbn: isbn || null,
          isbn13: isbn13 || null,
          goodreads_book_id: goodreadsBookId || null,
          published_year: publishedYear,
          rating: Number.isFinite(rating) ? rating : null,
          date_read: dateRead,
          shelf: shelf || bookshelves || null,
          source: "goodreads_import",
        } as LibraryBook;
      })
      .filter(Boolean) as LibraryBook[];

    if (!parsed.length) {
      toast.error("No valid rows found in Goodreads export.");
      setImportProgress(null);
      return;
    }

    setImporting(true);
    setImportProgress(`Parsing complete. ${parsed.length} valid rows found. Starting import...`);

    let created = 0;
    let updated = 0;

    try {
      let enriched: LibraryBook[] = parsed;
      if (enrichOnImport) {
        setImportProgress("Enriching metadata and covers from Google Books...");
        try {
          const batches: LibraryBook[][] = [];
          for (let i = 0; i < parsed.length; i += 8) {
            batches.push(parsed.slice(i, i + 8));
          }

          const enrichedResults: LibraryBook[] = [];
          let processed = 0;
          for (const batch of batches) {
            const { data, error } = await supabase.functions.invoke("goodreads-enrich", {
              body: {
                items: batch.map((item) => ({
                  isbn: item.isbn,
                  isbn13: item.isbn13,
                  title: item.title,
                  author: item.author,
                })),
              },
            });
            if (error) {
              failures.push(`Metadata enrichment batch failed: ${error.message}`);
            }
            const results = (data?.results || []) as Array<{
              description?: string | null;
              pageCount?: number | null;
              categories?: string[];
              thumbnail?: string | null;
            }>;
            batch.forEach((item, idx) => {
              const meta = results[idx];
              const cover = meta?.thumbnail || item.cover_url || item.thumbnail || null;
              enrichedResults.push({
                ...item,
                description: item.description || meta?.description || null,
                page_count: item.page_count ?? meta?.pageCount ?? null,
                genre: item.genre || meta?.categories?.[0] || "",
                cover_url: cover,
                thumbnail: cover,
                cover_source: cover ? "google_books" : item.cover_source || null,
                cover_failed_at: cover ? null : item.cover_failed_at || null,
              });
            });
            processed += batch.length;
            setImportProgress(`Enriched ${processed}/${parsed.length} books...`);
          }
          enriched = enrichedResults;
        } catch (error) {
          failures.push(`Metadata enrichment failed: ${(error as Error).message || "unknown error"}`);
          setImportProgress("Metadata enrichment failed. Continuing import with CSV data.");
        }
      }

      const existing = books;
      const keyToBook = new Map<string, LibraryBook>();
      existing.forEach((book) => {
        keyToBook.set(buildBookDedupeKey(book), book);
      });

      const upserts: LibraryBook[] = [];
      const seenKeys = new Set<string>();
      for (const incoming of enriched) {
        const key = buildBookDedupeKey(incoming);
        if (seenKeys.has(key)) {
          skipped += 1;
          continue;
        }
        seenKeys.add(key);

        const current = keyToBook.get(key);
        if (!current) {
          created += 1;
          upserts.push(incoming);
          keyToBook.set(key, incoming);
          continue;
        }

        updated += 1;
        const mergedRating = incoming.rating == null ? current.rating ?? null : incoming.rating;
        upserts.push({
          ...current,
          ...incoming,
          id: current.id,
          rating: mergedRating,
          genre: current.genre || incoming.genre || "",
          cover_url: current.cover_url || current.thumbnail || incoming.cover_url || incoming.thumbnail || null,
          thumbnail: current.cover_url || current.thumbnail || incoming.cover_url || incoming.thumbnail || null,
          cover_source: current.cover_source || incoming.cover_source || null,
          cover_failed_at: null,
        });
      }

      if (!upserts.length) {
        toast.error("No rows were eligible for import after dedupe.");
        setImportProgress(null);
        setImportSummary({ fileName: file.name, rowsRead, created, updated, skipped, merged: 0, errors: failures.length });
        return;
      }

      setImportProgress("Writing books to cloud library...");
      const { error } = await retryAsync(() => upsertBooksToCloud(userIdValue, upserts), 1, 350);
      if (error) {
        const syncError = await recordSyncError({ error, operation: "upsert", table: "books", userId: userIdValue });
        failures.push(syncError.message);
        enqueueLibrarySync(userIdValue, upserts, "goodreads_csv", file.name);
        setCloudNotice(syncError.userMessage || "Goodreads import queued for background sync.");
      }

      await loadBooks(userIdValue);
      await db.from("import_logs").insert({
        user_id: userIdValue,
        source: `goodreads_csv:${file.name}`,
        added_count: created,
        updated_count: updated,
        failed_count: failures.length,
        failures,
      });
      await loadImportLogs(userIdValue);

      const summary = {
        fileName: file.name,
        rowsRead,
        created,
        updated,
        skipped,
        merged: 0,
        errors: failures.length,
      };
      setImportSummary(summary);
      setImportProgress(null);
      toast.success(
        `Goodreads import complete. Rows: ${summary.rowsRead}, created: ${summary.created}, updated: ${summary.updated}, skipped: ${summary.skipped}, merged: ${summary.merged}, errors: ${summary.errors}.`
      );
    } finally {
      setImporting(false);
    }
  };

  /** Retry cover for a specific book */
  const retryCover = (book: LibraryBook) => {
    // Clear from failed set
    setFailedCovers((prev) => {
      const next = new Set(prev);
      next.delete(book.title + "|" + book.author);
      return next;
    });
    clearCoverCacheForBook(book);
    // Re-run enrichment for this single book
    enrichCovers([book], (_, coverUrl) => {
      setBooks((prev) => {
        const realIdx = prev.indexOf(book);
        if (realIdx < 0) return prev;
        const next = [...prev];
        next[realIdx] = {
          ...next[realIdx],
          cover_url: coverUrl,
          thumbnail: coverUrl,
          cover_source: "google_books",
          cover_failed_at: null,
        };
        setLocalBooks(next);
        return next;
      });
      if (userId && coverUrl) {
        upsertBooksToCloud(userId, [
          {
            ...book,
            cover_url: coverUrl,
            thumbnail: coverUrl,
            cover_source: "google_books",
            cover_failed_at: null,
          },
        ]).catch(async (err) => {
          await recordSyncError({ error: err, operation: "upsert", table: "books", userId });
        });
      }
      toast.success(`Cover found for "${book.title}"`);
    });
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl font-bold">My Library</h1>
          <p className="text-muted-foreground mt-2 font-body">
            Your personal book collection
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleLibraryUpload(file);
                event.target.value = "";
              }
            }}
          />
          {/* Removed duplicate sign-out - sign out lives in the navbar only */}
          {userLabel && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground font-body">
              <span>Signed in as {userLabel}</span>
            </div>
          )}
          <Dialog>
            <DialogTrigger asChild>
              <Button>Add Book</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl border border-border/60 bg-card/95 p-0">
              <div className="rounded-2xl overflow-hidden">
                <div className="px-8 py-6 bg-secondary/40 border-b border-border/60">
                  <DialogHeader>
                    <DialogTitle className="font-display text-2xl">
                      Library Checkout Card
                    </DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-muted-foreground font-body mt-2">
                    Fill in the card to generate a manual add code.
                  </p>
                </div>

                <div className="px-8 py-6 grid gap-5">
                  <div className="grid gap-2">
                    <Label htmlFor="book-title">Title</Label>
                    <Input id="book-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Name of the Wind" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="book-author">Author</Label>
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
                  <div className="rounded-xl border border-dashed border-border/60 bg-background/80 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body mb-2">Manual Add Code</div>
                    <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">{codeSnippet}</pre>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" className="text-xs px-3 h-8" onClick={() => fileInputRef.current?.click()}>
            Import CSV
          </Button>
        </div>
      </div>

      <Card className="mb-6 border-border/60 bg-card/70">
        <CardContent className="p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">Import</div>
          <h2 className="font-display text-2xl font-bold mt-2">Import CSV (Recommended)</h2>
          <p className="text-sm text-muted-foreground font-body mt-2">
            Use the template CSV. Includes <span className="font-medium">library_id</span> for stable imports.
          </p>
          <p className="text-xs text-muted-foreground font-body mt-2">
            If you're importing from Downloads, select your file (e.g., <span className="font-medium">defaultBookLibrary.csv</span>).
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => fileInputRef.current?.click()} disabled={defaultImporting}>
              {defaultImporting ? "Importing..." : "Choose CSV from Downloads"}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="/defaultBookLibrary.csv" download>
                Download CSV template
              </a>
            </Button>
          </div>
          {defaultImportProgress && (
            <p className="text-xs text-muted-foreground mt-3">{defaultImportProgress}</p>
          )}
          {defaultImportSummary && (
            <div className="mt-3 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-xs">
              <div className="font-medium">Latest import: {defaultImportSummary.fileName}</div>
              <div className="text-muted-foreground mt-1">
                Rows {defaultImportSummary.rowsRead} | Created {defaultImportSummary.created} | Updated {defaultImportSummary.updated} | Skipped {defaultImportSummary.skipped} | Merged {defaultImportSummary.merged} | Errors {defaultImportSummary.errors}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {cloudNotice && (
        <div className="mb-4 rounded-lg border border-border/60 bg-card/60 px-4 py-2 text-xs text-muted-foreground flex items-center justify-between gap-2">
          <span>{cloudNotice}</span>
          <Button variant="outline" size="sm" className="h-7 text-xs px-2 shrink-0" onClick={() => void retryCloudSync()}>
            Retry
          </Button>
        </div>
      )}

      {/* Stats banner */}
      {books.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-4 rounded-xl border border-border/60 bg-card/70 px-5 py-3 text-sm font-body">
          <span><strong>{stats.total}</strong> books</span>
          <span className="text-muted-foreground">|</span>
          <span><strong>{stats.tbr}</strong> TBR</span>
          <span className="text-muted-foreground">|</span>
          <span><strong>{stats.read}</strong> Finished</span>
          <span className="text-muted-foreground">|</span>
          <span><strong>{stats.authors}</strong> authors</span>
        </div>
      )}

      {/* Search + Sort controls */}
      {books.length > 0 && (
        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, author, series, or genre..."
              className="pl-10"
            />
          </div>
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

      <Accordion type="single" collapsible className="mb-10">
        <AccordionItem value="advanced" className="border border-border/60 rounded-xl bg-card/70">
          <AccordionTrigger className="px-6">
            <div className="flex items-center gap-2">
              <span className="font-display text-xl">Advanced</span>
              <Badge variant="outline" className="text-[10px]">Coming soon</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <Card className="border-border/60 bg-card/70">
                <CardContent className="p-6">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">Connect / Import</div>
                  <h2 className="font-display text-2xl font-bold mt-2">Goodreads Import (Preview)</h2>
                  <p className="text-sm text-muted-foreground font-body mt-2">
                    This is a preview CSV import (not an API connection yet). The recommended path is the default CSV above.
                  </p>
                  <ol className="list-decimal pl-5 mt-4 space-y-2 text-sm text-muted-foreground">
                    <li>Go to Goodreads &gt; My Books &gt; Import and Export.</li>
                    <li>Export your library to CSV.</li>
                    <li>Upload the CSV here.</li>
                  </ol>
                  <div className="mt-4 flex items-center gap-3">
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleGoodreadsImport(file);
                          event.target.value = "";
                        }
                      }}
                    />
                    <Button onClick={() => importInputRef.current?.click()} disabled={importing}>
                      {importing ? "Importing..." : "Import Goodreads CSV (Preview)"}
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={enrichOnImport} onCheckedChange={(checked) => setEnrichOnImport(checked === true)} />
                      Enrich metadata (Google Books)
                    </label>
                  </div>
                  {importProgress && (
                    <p className="text-xs text-muted-foreground mt-3">{importProgress}</p>
                  )}
                  {importSummary && (
                    <div className="mt-3 rounded-md border border-border/50 bg-background/70 px-3 py-2 text-xs">
                      <div className="font-medium">Latest import: {importSummary.fileName}</div>
                      <div className="text-muted-foreground mt-1">
                        Rows {importSummary.rowsRead} | Created {importSummary.created} | Updated {importSummary.updated} | Skipped {importSummary.skipped} | Merged {importSummary.merged} | Errors {importSummary.errors}
                      </div>
                    </div>
                  )}
                  {!userId && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Sign in to save import history and enrich metadata securely.
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/60 bg-card/70">
                <CardContent className="p-6">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">Import history</div>
                  <div className="flex items-center justify-between mt-2">
                    <h3 className="font-display text-xl font-bold">Recent imports</h3>
                    <div className="flex items-center gap-2">
                      {confirmClearLogs ? (
                        <>
                          <Button size="sm" variant="destructive" onClick={clearImportLogs}>Confirm clear</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmClearLogs(false)}>Cancel</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmClearLogs(true)}>Clear</Button>
                      )}
                    </div>
                  </div>
                  {loadingLogs ? (
                    <p className="text-sm text-muted-foreground mt-4">Loading history...</p>
                  ) : importLogs.length === 0 ? (
                    <p className="text-sm text-muted-foreground mt-4">No imports yet. Upload a Goodreads CSV (preview) to see history.</p>
                  ) : (
                    <div className="mt-4 grid gap-3">
                      {importLogs.map((log) => (
                        <div key={log.id} className="rounded-lg border border-border/50 bg-background/70 p-3 text-sm">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{log.source.replace(/_/g, " ")}</span>
                            <span>{new Date(log.created_at).toLocaleDateString()}</span>
                          </div>
                          <div className="mt-1">Added {log.added_count}, updated {log.updated_count}, failed {log.failed_count}</div>
                          {log.failed_count > 0 && (
                            <div className="mt-2 text-xs text-muted-foreground space-y-1">
                              {(log.failures || []).slice(0, 3).map((failure) => (
                                <div key={failure}>- {failure}</div>
                              ))}
                              {log.failed_count > 3 && (
                                <Button size="sm" variant="outline" className="mt-1" onClick={() => setSelectedFailures(log.failures || [])}>View all</Button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Drawer open={!!selectedFailures} onOpenChange={(open) => !open && setSelectedFailures(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Import failures</DrawerTitle>
            <p className="text-sm text-muted-foreground">These rows could not be imported.</p>
          </DrawerHeader>
          <div className="px-4 pb-4 max-h-[50vh] overflow-y-auto space-y-2 text-sm text-muted-foreground">
            {(selectedFailures || []).map((failure, index) => (
              <div key={`${failure}-${index}`}>- {failure}</div>
            ))}
          </div>
          <DrawerFooter>
            <Button variant="outline" onClick={() => setSelectedFailures(null)}>Close</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {displayedBooks.map((book, index) => {
            const bookKey = getBookKey(book);
            const normalizedStatus = normalizeStatus(book.status);
            const coverKey = book.title + "|" + book.author;
            const coverFailed = failedCovers.has(coverKey);
            const coverSrc = book.cover_url || book.thumbnail;
            return (
              <div
                key={book.id || `${buildBookDedupeKey(book)}-${index}`}
                className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm"
              >
                <div className="flex gap-3">
                  {/* Cover image with robust fallback */}
                  <div className="flex-shrink-0 w-16 aspect-[2/3] rounded-md overflow-hidden bg-secondary/40 flex items-center justify-center relative">
                    {coverSrc && !coverFailed ? (
                      <img
                        src={coverSrc}
                        alt={book.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() => {
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
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-1">
                        <BookOpen className="w-5 h-5 text-muted-foreground/40" />
                        {(coverFailed || !book.thumbnail) && (
                          <button
                            onClick={() => retryCover(book)}
                            className="text-[9px] text-primary/70 hover:text-primary flex items-center gap-0.5"
                            title="Retry cover fetch"
                          >
                            <RefreshCw className="w-2.5 h-2.5" /> retry
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <StatusSelector
                          value={normalizedStatus}
                          onChange={(next) => updateBookStatus(book, next)}
                          disabled={!!savingStatuses[bookKey]}
                        />
                        {savingStatuses[bookKey] && (
                          <span className="text-[10px] text-muted-foreground">Saving...</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" onClick={() => startEditing(index)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteBook(index)}>Delete</Button>
                      </div>
                    </div>
                    <h3 className="font-display text-lg font-bold mt-1 truncate">{book.title}</h3>
                    <p className="text-sm text-muted-foreground font-body truncate">{book.author}</p>
                    <div className="mt-2">
                      <StarRating
                        value={book.rating ?? null}
                        onChange={(next) => updateBookRating(book, next)}
                        saving={!!savingRatings[bookKey]}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground font-body mt-2 flex flex-wrap gap-1">
                      {book.genre && <span className="rounded-full bg-secondary/70 px-2 py-0.5">{book.genre}</span>}
                      {book.series_name && <span className="rounded-full bg-secondary/70 px-2 py-0.5">{book.series_name}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
    </main>
  );
};

export default Library;


