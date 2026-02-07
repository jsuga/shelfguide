import { useEffect, useMemo, useRef, useState } from "react";
import { BookMarked } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type LibraryBook = {
  id?: string;
  title: string;
  author: string;
  genre: string;
  series_name: string | null;
  is_first_in_series: boolean;
  status: string;
};

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

  const loadBooks = async (userIdValue: string | null) => {
    if (!userIdValue) {
      setBooks(getLocalBooks());
      return;
    }
    setLoadingBooks(true);
    const { data, error } = await (supabase as any)
      .from("books")
      .select("*")
      .eq("user_id", userIdValue)
      .order("created_at", { ascending: false });
    setLoadingBooks(false);

    if (error) {
      toast.error("Could not load your cloud library. Showing local data.");
      setBooks(getLocalBooks());
      return;
    }

    const cloudBooks = (data || []) as LibraryBook[];
    setBooks(cloudBooks);

    const localBooks = getLocalBooks();
    if (cloudBooks.length === 0 && localBooks.length > 0 && userIdValue) {
      const { error: insertError } = await (supabase as any)
        .from("books")
        .insert(localBooks.map((book) => ({ ...book, user_id: userIdValue })));
      if (!insertError) {
        setLocalBooks([]);
        const { data: refreshed } = await (supabase as any)
          .from("books")
          .select("*")
          .eq("user_id", userIdValue)
          .order("created_at", { ascending: false });
        setBooks((refreshed || []) as LibraryBook[]);
        toast.success("Migrated your local library to the cloud.");
      }
    }
  };

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      setUserId(user?.id ?? null);
      const username = (user?.user_metadata as { username?: string })?.username;
      setUserLabel(username || user?.email || null);
      await loadBooks(user?.id ?? null);
    };

    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserId(user?.id ?? null);
      const username = (user?.user_metadata as { username?: string })?.username;
      setUserLabel(username || user?.email || null);
      void loadBooks(user?.id ?? null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);


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
    const book = books[index];
    if (!book) return;
    setEditingIndex(index);
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
        const { error } = await (supabase as any)
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

  const deleteBook = (index: number) => {
    const target = books[index];
    if (userId && target?.id) {
      (async () => {
        const { error } = await (supabase as any)
          .from("books")
          .delete()
          .eq("id", target.id);
        if (error) {
          toast.error("Could not delete book.");
          return;
        }
        const nextBooks = books.filter((_, i) => i !== index);
        setBooks(nextBooks);
        toast.success("Book removed.");
      })();
      return;
    }
    const nextBooks = books.filter((_, i) => i !== index);
    persistBooks(nextBooks);
    toast.success("Book removed.");
  };

  const normalizeHeader = (value: string) =>
    value.trim().toLowerCase().replace(/[\s-]+/g, "_");

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
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      const { error } = await (supabase as any)
        .from("books")
        .insert(booksFromCsv.map((book) => ({ ...book, user_id: userId })));
      if (error) {
        toast.error("Upload failed. Saved locally instead.");
        const nextBooks = [...books, ...booksFromCsv];
        persistBooks(nextBooks);
        return;
      }
      await loadBooks(userId ?? null);
      toast.success(`Added ${booksFromCsv.length} book${booksFromCsv.length === 1 ? "" : "s"} from CSV.`);
      return;
    }

    const nextBooks = [...books, ...booksFromCsv];
    persistBooks(nextBooks);
    toast.success(`Added ${booksFromCsv.length} book${booksFromCsv.length === 1 ? "" : "s"} from CSV.`);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out. Using local library.");
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
              <Button>
                Add Book
              </Button>
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
                    <Input
                      id="book-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="The Name of the Wind"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="book-author">Author</Label>
                    <Input
                      id="book-author"
                      value={author}
                      onChange={(event) => setAuthor(event.target.value)}
                      placeholder="Patrick Rothfuss"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="book-genre">Genre</Label>
                    <Input
                      id="book-genre"
                      value={genre}
                      onChange={(event) => setGenre(event.target.value)}
                      placeholder="Fantasy"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="book-series">Series Name</Label>
                    <Input
                      id="book-series"
                      value={seriesName}
                      onChange={(event) => setSeriesName(event.target.value)}
                      placeholder="The Kingkiller Chronicle"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="book-first"
                      checked={isFirstInSeries}
                      onCheckedChange={(checked) => setIsFirstInSeries(checked === true)}
                    />
                    <Label htmlFor="book-first">Is first in series</Label>
                  </div>

                  <div className="grid gap-2">
                    <Label>Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
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
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body mb-2">
                      Manual Add Code
                    </div>
                    <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/90">
{codeSnippet}
                    </pre>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="sm"
            className="text-xs px-3 h-8"
            onClick={() => fileInputRef.current?.click()}
          >
            Add Library
          </Button>
        </div>
      </div>

      {books.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookMarked className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h2 className="font-display text-2xl font-bold mb-2">
            {loadingBooks ? "Loading library..." : "No books yet"}
          </h2>
          <p className="text-muted-foreground max-w-md font-body">
            Start building your library by adding books you've read, are reading, or
            want to read.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {books.map((book, index) => (
            <div
              key={`${book.title}-${index}`}
              className="rounded-xl border border-border/60 bg-card/70 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
                  {book.status.replace(/_/g, " ")}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startEditing(index)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteBook(index)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <h3 className="font-display text-xl font-bold mt-2">
                {book.title}
              </h3>
              <p className="text-sm text-muted-foreground font-body mt-1">
                {book.author}
              </p>
              <div className="text-xs text-muted-foreground font-body mt-3 flex flex-wrap gap-2">
                {book.genre && (
                  <span className="rounded-full bg-secondary/70 px-3 py-1">
                    {book.genre}
                  </span>
                )}
                {book.series_name && (
                  <span className="rounded-full bg-secondary/70 px-3 py-1">
                    {book.series_name}
                  </span>
                )}
                {book.is_first_in_series && (
                  <span className="rounded-full bg-secondary/70 px-3 py-1">
                    First in series
                  </span>
                )}
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
                <DialogTitle className="font-display text-2xl">
                  Edit Library Card
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground font-body mt-2">
                Update details for this book.
              </p>
            </div>

            <div className="px-8 py-6 grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-author">Author</Label>
                <Input
                  id="edit-author"
                  value={editAuthor}
                  onChange={(event) => setEditAuthor(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-genre">Genre</Label>
                <Input
                  id="edit-genre"
                  value={editGenre}
                  onChange={(event) => setEditGenre(event.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-series">Series Name</Label>
                <Input
                  id="edit-series"
                  value={editSeriesName}
                  onChange={(event) => setEditSeriesName(event.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-first"
                  checked={editIsFirstInSeries}
                  onCheckedChange={(checked) => setEditIsFirstInSeries(checked === true)}
                />
                <Label htmlFor="edit-first">Is first in series</Label>
              </div>

              <div className="grid gap-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
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
                <Button variant="outline" onClick={() => setEditingIndex(null)}>
                  Cancel
                </Button>
                <Button onClick={saveEdits}>
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </main>
  );
};

export default Library;
