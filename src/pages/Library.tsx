import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, BookOpen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
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
import { buildBookDedupeKey } from "@/lib/bookDedupe";
import { applySort, type SortMode } from "@/lib/librarySort";
import { enrichCovers } from "@/lib/coverEnrichment";

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
  const coverCacheInFlightRef = useRef<Set<string>>(new Set());
  const coverCacheProcessingRef = useRef(false);
  const coverCacheAuthNoticeRef = useRef(false);

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
    if (!userId || books.length === 0) return;
    const candidates = books.filter(
      (book) =>
        !!book.id &&
        !book.cover_storage_path &&
        (book.cover_url || book.thumbnail)
    );
    if (candidates.length === 0) return;

    const pending = candidates.filter((book) => !coverCacheInFlightRef.current.has(book.id || ""));
    if (pending.length === 0) return;
    pending.forEach((book) => {
      if (book.id) coverCacheInFlightRef.current.add(book.id);
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
              const { data: sess } = await supabase.auth.getSession();
              if (!sess.session) return;

              const { data, error } = await supabase.functions.invoke("cache-book-cover", {
                body: { book_id: book.id },
              });

              if (error) {
                console.warn("[cover-cache] error for", book.id, error);
                return;
              }

              setBooks((prev) => {
                const next = prev.map((entry) =>
                  entry.id === book.id
                    ? {
                        ...entry,
                        cover_storage_path: data?.cover_storage_path,
                        cover_cache_status: "cached" as const,
                        cover_cache_error: null,
                      }
                    : entry
                );
                setLocalBooks(next);
                return next;
              });
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

  const getStorageCoverUrl = (path: string | null | undefined) => {
    if (!path) return null;
    const { data } = supabase.storage.from("book-covers").getPublicUrl(path);
    return data?.publicUrl || null;
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
      <div className="flex items-center justify-between mb-8">
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
        <div className="flex flex-col items-end gap-2">
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
          <Button
            variant="outline"
            size="sm"
            className="text-xs px-3 h-8"
            onClick={() => toast.message("Import Library is coming soon. Use Download CSV Template for now.")}
          >
            Import Library
          </Button>
        </div>
      </div>

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
            const storageCover = getStorageCoverUrl(book.cover_storage_path);
            const coverSrc = storageCover || book.cover_url || book.thumbnail;
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
                        {coverFailed && (
                          <span className="text-[9px] text-muted-foreground">cover unavailable</span>
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


