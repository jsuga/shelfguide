import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, BookOpen, Search, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  enqueueLibrarySync,
  flushAllPendingSync,
  getAuthenticatedUserId,
  retryAsync,
  upsertBooksToCloud,
} from "@/lib/cloudSync";
import { buildBookDedupeKey, normalizeDedupeValue } from "@/lib/bookDedupe";
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
  rating?: number | null;
  date_read?: string | null;
  shelf?: string | null;
  description?: string | null;
  page_count?: number | null;
  thumbnail?: string | null;
  source?: string | null;
};

const db = supabase as any;

const Library = () => {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [isFirstInSeries, setIsFirstInSeries] = useState(false);
  const [status, setStatus] = useState("want_to_read");
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editGenre, setEditGenre] = useState("");
  const [editSeriesName, setEditSeriesName] = useState("");
  const [editIsFirstInSeries, setEditIsFirstInSeries] = useState(false);
  const [editStatus, setEditStatus] = useState("want_to_read");
  const [userId, setUserId] = useState<string | null>(null);
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
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
      setCloudNotice("Cloud sync is unavailable — using local-only data for now.");
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
      setCloudNotice("Cloud sync is unavailable — using local-only data for now.");
      setBooks(getLocalBooks());
      return;
    }
    setCloudNotice(null);

    const cloudBooks = (data || []) as LibraryBook[];
    setBooks(cloudBooks);

    const localBooks = getLocalBooks();
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

  // Cover enrichment effect
  const enrichRunRef = useRef(false);
  useEffect(() => {
    if (books.length === 0 || enrichRunRef.current) return;
    const needsCovers = books.some((b) => !b.thumbnail);
    if (!needsCovers) return;
    enrichRunRef.current = true;
    enrichCovers(books, (index, coverUrl) => {
      setBooks((prev) => {
        const next = [...prev];
        if (next[index]) next[index] = { ...next[index], thumbnail: coverUrl };
        return next;
      });
      // Sync cover to cloud if signed in
      const book = books[index];
      if (userId && book) {
        upsertBooksToCloud(userId, [{ ...book, thumbnail: coverUrl }]).catch(() => {});
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

  // Canonical status normalizer -- single source of truth for status mapping
  const normalizeStatus = (raw: string | null | undefined): string => {
    if (!raw) return "want_to_read";
    const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (["tbr", "to_read", "want_to_read"].includes(s)) return "tbr";
    if (["reading", "currently_reading"].includes(s)) return "reading";
    if (["read", "finished"].includes(s)) return "finished";
    if (s === "paused") return "paused";
    return s;
  };

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
    setEditStatus(book.status || "want_to_read");
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

    if (userId && target?.id) {
      (async () => {
        const { error } = await db
          .from("books")
          .update(updatedBook)
          .eq("id", target.id);
        if (error) {
          toast.error("Could not update book.");
          return;
        }
        const nextBooks = [...books];
        nextBooks[editingIndex] = { ...updatedBook, id: target.id };
        setBooks(nextBooks);
        setEditingIndex(null);
        toast.success("Book updated.");
      })();
      return;
    }

    const nextBooks = [...books];
    nextBooks[editingIndex] = { ...updatedBook, id: target?.id };
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
          toast.error("Could not delete book.");
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
    value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  const stripGoodreadsIsbn = (raw: string) => {
    return raw.replace(/^="?|"$/g, "").trim();
  };

  const mapShelfToStatus = (shelf: string) => {
    const normalized = normalizeDedupeValue(shelf);
    if (normalized === "to-read") return "tbr";
    if (normalized === "currently-reading") return "reading";
    if (normalized === "read") return "finished";
    return "want_to_read";
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
    const text = await file.text();
    const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length));
    if (rows.length < 2) {
      toast.error("CSV is empty or missing rows.");
      return;
    }

    const headers = rows[0].map(normalizeHeader);
    const dataRows = rows.slice(1);
    const booksFromCsv: LibraryBook[] = [];

    dataRows.forEach((row) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = (row[index] || "").trim();
      });

      if (!record.title || !record.author) return;

      booksFromCsv.push({
        title: record.title,
        author: record.author,
        genre: record.genre || "",
        series_name: record.series_name || null,
        is_first_in_series: ["true", "yes", "1"].includes(
          (record.is_first_in_series || "").toLowerCase()
        ),
        status: record.status || "want_to_read",
      });
    });

    if (!booksFromCsv.length) {
      toast.error("No valid rows found. Ensure title and author columns exist.");
      return;
    }

    if (userId) {
      const userIdValue = await getAuthenticatedUserId();
      if (!userIdValue) {
        const nextBooks = [...books, ...booksFromCsv];
        persistBooks(nextBooks);
        enqueueLibrarySync(userIdValue, booksFromCsv, "manual_csv_upload", file.name);
        setCloudNotice("Not signed in. Saved locally and queued for cloud sync.");
        return;
      }

      const { error } = await retryAsync(
        () => upsertBooksToCloud(userIdValue, booksFromCsv),
        1,
        350
      );
      if (error) {
        toast.error(`Upload failed: ${error.message}. Saved locally and queued for retry.`);
        const nextBooks = [...books, ...booksFromCsv];
        persistBooks(nextBooks);
        enqueueLibrarySync(userIdValue, booksFromCsv, "manual_csv_upload", file.name);
        setCloudNotice("Cloud sync pending. We will retry automatically.");
        return;
      }
      await loadBooks(userIdValue);
      toast.success(`Added ${booksFromCsv.length} book${booksFromCsv.length === 1 ? "" : "s"} from CSV.`);
      return;
    }

    const nextBooks = [...books, ...booksFromCsv];
    persistBooks(nextBooks);
    toast.success(`Added ${booksFromCsv.length} book${booksFromCsv.length === 1 ? "" : "s"} from CSV.`);
  };

  const handleGoodreadsImport = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length));
    if (rows.length < 2) {
      toast.error("CSV is empty or missing rows.");
      return;
    }

    const headers = rows[0].map(normalizeHeader);
    const dataRows = rows.slice(1);
    const failures: string[] = [];

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
          failures.push(`Row ${index + 2}: missing title or author.`);
          return null;
        }
        const shelf = record.exclusive_shelf || record.shelf || "";
        const bookStatus = shelf ? mapShelfToStatus(shelf) : "want_to_read";
        const isbn = stripGoodreadsIsbn(record.isbn || "");
        const isbn13 = stripGoodreadsIsbn(record.isbn13 || "");
        const rawRating = record.my_rating ? Number(record.my_rating) : null;
        const rating = rawRating && rawRating > 0 ? rawRating : null;
        const dateRead = record.date_read?.trim() || null;
        return {
          title: bookTitle,
          author: bookAuthor,
          genre: record.genre?.trim() || "",
          series_name: record.series_name?.trim() || null,
          is_first_in_series: false,
          status: bookStatus,
          isbn: isbn || null,
          isbn13: isbn13 || null,
          rating: Number.isFinite(rating) ? rating : null,
          date_read: dateRead,
          shelf: shelf || null,
          source: "goodreads_import",
        } as LibraryBook;
      })
      .filter(Boolean) as LibraryBook[];

    if (!parsed.length) {
      toast.error("No valid rows found in Goodreads export.");
      return;
    }

    setImporting(true);

    let enriched: LibraryBook[] = parsed;
    if (userId && enrichOnImport) {
      try {
        const batches: LibraryBook[][] = [];
        for (let i = 0; i < parsed.length; i += 8) {
          batches.push(parsed.slice(i, i + 8));
        }

        const enrichedResults: LibraryBook[] = [];
        for (const batch of batches) {
          const { data } = await supabase.functions.invoke("goodreads-enrich", {
            body: {
              items: batch.map((item) => ({
                isbn: item.isbn,
                isbn13: item.isbn13,
                title: item.title,
                author: item.author,
              })),
            },
          });
          const results = (data?.results || []) as Array<{
            description?: string | null;
            pageCount?: number | null;
            categories?: string[];
            thumbnail?: string | null;
          }>;
          batch.forEach((item, idx) => {
            const meta = results[idx];
            enrichedResults.push({
              ...item,
              description: meta?.description || item.description || null,
              page_count: meta?.pageCount ?? item.page_count ?? null,
              genre: meta?.categories?.[0] || item.genre || "",
              thumbnail: meta?.thumbnail || item.thumbnail || null,
            });
          });
        }
        enriched = enrichedResults;
      } catch {
        toast.error("Metadata enrichment failed. Imported without extra details.");
      }
    }

    const existing = books;
    const keyToIndex = new Map<string, number>();
    existing.forEach((book, index) => {
      keyToIndex.set(buildBookDedupeKey(book), index);
    });

    let added = 0;
    let updated = 0;
    const upserts: LibraryBook[] = [];

    enriched.forEach((book) => {
      const key = buildBookDedupeKey(book);
      const existingIndex = keyToIndex.get(key);
      if (existingIndex === undefined) {
        added += 1;
        upserts.push(book);
        keyToIndex.set(key, existing.length + upserts.length - 1);
        return;
      }

      const current = existing[existingIndex];
      const merged: LibraryBook = {
        ...current,
        status: book.status || current.status,
        shelf: book.shelf || current.shelf,
        isbn: current.isbn || book.isbn,
        isbn13: current.isbn13 || book.isbn13,
        rating: current.rating ?? book.rating ?? null,
        date_read: current.date_read || book.date_read || null,
        description: current.description || book.description || null,
        page_count: current.page_count ?? book.page_count ?? null,
        thumbnail: current.thumbnail || book.thumbnail || null,
        genre: current.genre || book.genre,
      };
      updated += 1;
      upserts.push(merged);
    });

    if (userId) {
      const { error } = await retryAsync(() => upsertBooksToCloud(userId, upserts), 1, 350);
      if (error) {
        failures.push(error.message);
        enqueueLibrarySync(userId, upserts, "goodreads_csv", file.name);
        setCloudNotice("Goodreads import queued for background sync.");
      }
      await loadBooks(userId);
      await db.from("import_logs").insert({
        user_id: userId,
        source: `goodreads_csv:${file.name}`,
        added_count: added,
        updated_count: updated,
        failed_count: failures.length,
        failures,
      });
      await loadImportLogs(userId);
    } else {
      const nextBooks = [...books];
      upserts.forEach((book) => {
        const key = buildBookDedupeKey(book);
        const existingIndex = keyToIndex.get(key);
        if (existingIndex === undefined) {
          nextBooks.push(book);
          keyToIndex.set(key, nextBooks.length - 1);
        } else {
          nextBooks[existingIndex] = book;
        }
      });
      persistBooks(nextBooks);
    }

    setImporting(false);
    toast.success(
      `Goodreads import complete. Added ${added}, updated ${updated}, failed ${failures.length}.`
    );
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out. Using local library.");
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={`w-3 h-3 ${n <= rating ? "text-primary fill-primary" : "text-muted-foreground/30"}`}
          />
        ))}
      </div>
    );
  };

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-4xl font-bold">My Library</h1>
          <p className="text-muted-foreground mt-2 font-body">
            Your personal book collection
          </p>
          <div className="mt-3">
            <Button variant="outline" size="sm" asChild>
              <a href="/defaultBookLibrary.csv" download>
                Download CSV template
              </a>
            </Button>
          </div>
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
          {userLabel && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground font-body">
              <span>Signed in as {userLabel}</span>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                Sign out
              </Button>
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
                        <SelectItem value="want_to_read">Want to read</SelectItem>
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
            Add Library
          </Button>
        </div>
      </div>

      {cloudNotice && (
        <div className="mb-4 rounded-lg border border-border/60 bg-card/60 px-4 py-2 text-xs text-muted-foreground">
          {cloudNotice}
        </div>
      )}

      {/* Stats banner */}
      {books.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-4 rounded-xl border border-border/60 bg-card/70 px-5 py-3 text-sm font-body">
          <span><strong>{stats.total}</strong> books</span>
          <span className="text-muted-foreground">|</span>
          <span><strong>{stats.tbr}</strong> TBR</span>
          <span className="text-muted-foreground">|</span>
          <span><strong>{stats.read}</strong> Read</span>
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

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] mb-10">
        <Card className="border-border/60 bg-card/70">
          <CardContent className="p-6">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">Connect / Import</div>
            <h2 className="font-display text-2xl font-bold mt-2">Goodreads Import</h2>
            <p className="text-sm text-muted-foreground font-body mt-2">
              This is a CSV import (not an API connection yet). You can re-run it anytime.
            </p>
            <p className="text-xs text-muted-foreground font-body mt-2">
              Need a starter format for physical library uploads? Download the default template.
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
                {importing ? "Importing..." : "Import Goodreads CSV"}
              </Button>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={enrichOnImport} onCheckedChange={(checked) => setEnrichOnImport(checked === true)} />
                Enrich metadata (Google Books)
              </label>
            </div>
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
              <p className="text-sm text-muted-foreground mt-4">No imports yet. Upload a Goodreads CSV to see history.</p>
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
          {displayedBooks.map((book, index) => (
            <div
              key={`${book.title}-${book.id || index}`}
              className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm"
            >
              <div className="flex gap-3">
                {/* Cover image */}
                <div className="flex-shrink-0 w-16 aspect-[2/3] rounded-md overflow-hidden bg-secondary/40 flex items-center justify-center">
                  {book.thumbnail ? (
                    <img
                      src={book.thumbnail}
                      alt={book.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        if (import.meta.env.DEV) console.warn(`[ShelfGuide] Cover load failed: "${book.title}" url=${book.thumbnail}`);
                        (e.target as HTMLImageElement).style.display = "none";
                        (e.target as HTMLImageElement).parentElement?.classList.add("cover-failed");
                      }}
                    />
                  ) : (
                    <BookOpen className="w-6 h-6 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
                      {normalizeStatus(book.status).replace(/_/g, " ")}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => startEditing(index)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteBook(index)}>Delete</Button>
                    </div>
                  </div>
                  <h3 className="font-display text-lg font-bold mt-1 truncate">{book.title}</h3>
                  <p className="text-sm text-muted-foreground font-body truncate">{book.author}</p>
                  {book.rating && book.rating > 0 && (
                    <div className="mt-1">{renderStars(book.rating)}</div>
                  )}
                  <div className="text-xs text-muted-foreground font-body mt-2 flex flex-wrap gap-1">
                    {book.genre && <span className="rounded-full bg-secondary/70 px-2 py-0.5">{book.genre}</span>}
                    {book.series_name && <span className="rounded-full bg-secondary/70 px-2 py-0.5">{book.series_name}</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
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
                    <SelectItem value="want_to_read">Want to read</SelectItem>
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
