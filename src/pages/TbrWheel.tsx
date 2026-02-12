import { useEffect, useMemo, useState } from "react";
import { Sparkles, RotateCw, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  applyTbrFilters,
  dedupeCandidatesAgainstOwned,
  pickWinnerIndex,
  sampleForWheel,
  type TbrBook,
  type TbrFilters,
  type TbrWheelGenre,
  TBR_WHEEL_GENRES,
  type TbrFirstInSeriesFilter,
  type TbrOwnershipMode,
} from "@/lib/tbrWheel";

type LibraryBook = TbrBook & {
  thumbnail?: string | null;
  status?: string | null;
  user_id?: string;
  series_name?: string | null;
  is_first_in_series?: boolean | null;
  isbn?: string | null;
  isbn13?: string | null;
  source?: string | null;
};

const LIBRARY_KEY = "reading-copilot-library";
const WHEEL_MAX = 30;

const getLocalBooks = (): LibraryBook[] => {
  const stored = localStorage.getItem(LIBRARY_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as LibraryBook[];
  } catch {
    return [];
  }
};

const setLocalBooks = (books: LibraryBook[]) => {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(books));
};

const defaultFilters: TbrFilters = {
  genres: ["Any"],
  firstInSeries: "any",
  ownership: "library",
  length: "Any",
};

type CopilotRecommendation = {
  id: string;
  title: string;
  author: string;
  genre: string;
};

const normalize = (value: string) => value.trim().toLowerCase();

const getSelectedGenres = (filters: TbrFilters) =>
  filters.genres.filter((genre) => genre !== "Any") as TbrWheelGenre[];

const buildCopilotPrompts = (filters: TbrFilters) => {
  const selectedGenres = getSelectedGenres(filters);
  const genrePrompt =
    selectedGenres.length > 0
      ? `genres: ${selectedGenres.join(", ")}`
      : "genres: broad mix";

  const firstPrompt =
    filters.firstInSeries === "first_only"
      ? "prefer first books in series"
      : filters.firstInSeries === "not_first"
      ? "prefer standalones or not-first-in-series books"
      : "series position: any";

  return [
    `tbr recommendations, ${genrePrompt}, ${firstPrompt}`,
    `reader wants new picks, ${genrePrompt}, ${firstPrompt}`,
    `recommend outside owned library, ${genrePrompt}, ${firstPrompt}`,
    `discoverable books for reading next, ${genrePrompt}, ${firstPrompt}`,
  ];
};

const parseGoogleBook = (payload: unknown) => {
  const data = payload as {
    items?: Array<{
      volumeInfo?: {
        categories?: string[];
        pageCount?: number;
        imageLinks?: { thumbnail?: string };
        industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
      };
    }>;
  };
  const first = data?.items?.[0]?.volumeInfo;
  if (!first) return null;
  const identifiers = first.industryIdentifiers || [];
  const isbn13 =
    identifiers.find((entry) => normalize(entry.type || "") === "isbn_13")?.identifier || null;
  const isbn =
    identifiers.find((entry) => normalize(entry.type || "") === "isbn_10")?.identifier || null;
  return {
    categories: first.categories || [],
    page_count: first.pageCount ?? null,
    thumbnail: first.imageLinks?.thumbnail || null,
    isbn,
    isbn13,
  };
};

const enrichFromGoogleBooks = async (book: CopilotRecommendation) => {
  const query = `intitle:${book.title} inauthor:${book.author}`;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("printType", "books");
  url.searchParams.set("langRestrict", "en");

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return null;
    const payload = await response.json();
    return parseGoogleBook(payload);
  } catch {
    return null;
  }
};

const TbrWheel = () => {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [filters, setFilters] = useState<TbrFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<TbrFilters>(defaultFilters);
  const [externalCandidates, setExternalCandidates] = useState<LibraryBook[]>([]);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [sampleNonce, setSampleNonce] = useState(0);
  const [wheelBooks, setWheelBooks] = useState<LibraryBook[]>([]);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<LibraryBook | null>(null);
  const [spinDuration, setSpinDuration] = useState(2800);

  const loadBooks = async (userIdValue: string | null) => {
    if (!userIdValue) {
      setBooks(getLocalBooks());
      return;
    }
    const { data, error } = await supabase
      .from("books")
      .select("*")
      .eq("user_id", userIdValue);
    if (error) {
      toast.error("Could not load your library. Showing local data.");
      setBooks(getLocalBooks());
      return;
    }
    setBooks((data || []) as LibraryBook[]);
  };

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      setUserId(user?.id ?? null);
      await loadBooks(user?.id ?? null);
    };
    void init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserId(user?.id ?? null);
      void loadBooks(user?.id ?? null);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const sourceBooks = useMemo(() => {
      if (appliedFilters.ownership === "library") {
        return books.filter((book) => normalize(book.status || "") === "tbr");
      }
      return externalCandidates;
    }, [appliedFilters.ownership, books, externalCandidates]);

  const filtered = useMemo(
    () => applyTbrFilters(sourceBooks, appliedFilters),
    [sourceBooks, appliedFilters]
  );

  const displayed = useMemo(() => {
    void sampleNonce;
    return sampleForWheel(filtered, WHEEL_MAX);
  }, [filtered, sampleNonce]);

  useEffect(() => {
    setWheelBooks(displayed);
  }, [displayed]);

  const refreshSample = () => {
    setSampleNonce((value) => value + 1);
    setWinner(null);
    setRotation(0);
  };

  const loadExternalCandidates = async (nextFilters: TbrFilters) => {
    if (!userId) {
      setExternalCandidates([]);
      toast.error("Sign in to get recommendations outside your library.");
      return;
    }

    setLoadingExternal(true);
    const prompts = buildCopilotPrompts(nextFilters);

    const results = await Promise.all(
      prompts.map(async (prompt) => {
        const { data, error } = await supabase.functions.invoke("reading-copilot", {
          body: {
            prompt,
            tags: getSelectedGenres(nextFilters).map((genre) => normalize(genre)),
            surprise: 55,
            limit: 6,
          },
        });
        if (error) return [] as CopilotRecommendation[];
        const recs = (data?.recommendations || []) as CopilotRecommendation[];
        return recs;
      })
    );

    const flat = results.flat();
    if (flat.length === 0) {
      setExternalCandidates([]);
      setLoadingExternal(false);
      toast.error("Could not load recommendation candidates from Copilot.");
      return;
    }

    const enriched = await Promise.all(
      flat.map(async (candidate) => {
        const meta = await enrichFromGoogleBooks(candidate);
        return {
          id: candidate.id,
          title: candidate.title,
          author: candidate.author,
          genre: meta?.categories?.[0] || candidate.genre || null,
          status: "tbr",
          is_first_in_series: false,
          series_name: null,
          page_count: meta?.page_count ?? null,
          thumbnail: meta?.thumbnail || null,
          isbn: meta?.isbn || null,
          isbn13: meta?.isbn13 || null,
          source: "copilot_recommendation",
        } as LibraryBook;
      })
    );

    const deduped = dedupeCandidatesAgainstOwned(enriched, books);
    setExternalCandidates(deduped);
    setLoadingExternal(false);
    if (deduped.length === 0) {
      toast.error("No non-owned recommendations matched your filters.");
    }
  };

  const applyFilters = async () => {
    const next = {
      ...filters,
      length: filters.ownership === "library" ? "Any" : filters.length,
    };
    setAppliedFilters(next);
    if (next.ownership === "not_owned") {
      await loadExternalCandidates(next);
    }
    setWinner(null);
    setRotation(0);
    setSampleNonce((value) => value + 1);
  };

  const spin = () => {
    if (wheelBooks.length === 0 || spinning) return;
    const winnerIndex = pickWinnerIndex(wheelBooks.length);
    const anglePer = 360 / wheelBooks.length;
    const turns = 3;
    const targetRotation =
      rotation + turns * 360 + (360 - winnerIndex * anglePer - anglePer / 2);
    setSpinDuration(2800);
    setRotation(targetRotation);
    setSpinning(true);
    setTimeout(() => {
      setWinner(wheelBooks[winnerIndex] ?? null);
      setSpinning(false);
    }, 2800);
  };

  const addWinnerToLibrary = async () => {
    if (!winner) return;
    const payload = {
      title: winner.title,
      author: winner.author,
      genre: winner.genre || "",
      series_name: winner.series_name || null,
      is_first_in_series: winner.is_first_in_series === true,
      status: "tbr",
      page_count: winner.page_count ?? null,
      thumbnail: winner.thumbnail || null,
      isbn: winner.isbn || null,
      isbn13: winner.isbn13 || null,
      source: winner.source || "tbr_wheel",
    };

    if (userId) {
      const { data, error } = await supabase
        .from("books")
        .insert([{ ...payload, user_id: userId }])
        .select("*")
        .single();
      if (error) {
        toast.error("Could not add this book to your library.");
        return;
      }
      const nextBooks = [data as LibraryBook, ...books];
      setBooks(nextBooks);
      setExternalCandidates((current) =>
        current.filter(
          (entry) =>
            !(
              normalize(entry.title) === normalize(winner.title) &&
              normalize(entry.author) === normalize(winner.author)
            )
        )
      );
      toast.success("Added to your library as TBR.");
      return;
    }

    const nextBooks = [{ ...payload }, ...books];
    setBooks(nextBooks);
    setLocalBooks(nextBooks);
    toast.success("Added to your local library as TBR.");
  };

  const startReading = async () => {
    if (!winner) return;
    if (userId && winner.id) {
      const { error } = await supabase
        .from("books")
        .update({ status: "reading" })
        .eq("id", winner.id);
      if (error) {
        toast.error("Could not update status.");
        return;
      }
      await loadBooks(userId);
      toast.success("Marked as reading.");
      return;
    }

    const next = books.map((book) =>
      book.title === winner.title && book.author === winner.author
        ? { ...book, status: "reading" }
        : book
    );
    setBooks(next);
    setLocalBooks(next);
    toast.success("Marked as reading.");
  };

  const saveToHistory = async () => {
    if (!winner || !userId) return;
    const { error } = await supabase.from("copilot_recommendations").insert({
      user_id: userId,
      book_id: winner.id ?? null,
      title: winner.title,
      author: winner.author,
      genre: winner.genre ?? null,
      tags: [],
      summary: null,
      source: "tbr_wheel",
      reasons: ["Selected via TBR Wheel."],
      why_new: null,
    });
    if (error) {
      toast.error("Could not save to history.");
      return;
    }
    toast.success("Saved to recently recommended.");
  };

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">TBR Wheel</h1>
        <p className="text-muted-foreground mt-2 font-body">
          Reduce decision fatigue and spin your next read.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl border border-border/60 bg-card/70 p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
            Filters
          </div>
          <div className="mt-4 grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Genre</label>
              <div className="rounded-lg border border-border/60 bg-background/60 p-3 grid gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={filters.genres.includes("Any")}
                    onCheckedChange={(checked) =>
                      setFilters((prev) => ({
                        ...prev,
                        genres: checked ? ["Any"] : [],
                      }))
                    }
                  />
                  Any
                </label>
                {TBR_WHEEL_GENRES.map((genre) => (
                  <label key={genre} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={filters.genres.includes(genre)}
                      onCheckedChange={(checked) =>
                        setFilters((prev) => {
                          const withoutAny = prev.genres.filter((value) => value !== "Any");
                          if (checked) {
                            return { ...prev, genres: [...withoutAny, genre] };
                          }
                          const nextGenres = withoutAny.filter((value) => value !== genre);
                          return { ...prev, genres: nextGenres.length ? nextGenres : ["Any"] };
                        })
                      }
                    />
                    {genre}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">First in series</label>
              <Select
                value={filters.firstInSeries}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    firstInSeries: value as TbrFirstInSeriesFilter,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Series filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="first_only">First in series only</SelectItem>
                  <SelectItem value="not_first">Not first in series</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Ownership</label>
              <Select
                value={filters.ownership}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    ownership: value as TbrOwnershipMode,
                    length: value === "library" ? "Any" : prev.length,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select ownership mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="library">In my library</SelectItem>
                  <SelectItem value="not_owned">Not owned / recommend outside my library</SelectItem>
                </SelectContent>
              </Select>
              {filters.ownership === "not_owned" && (
                <div className="text-xs text-muted-foreground">
                  In-library mode always spins from your TBR books.
                </div>
              )}
            </div>

            {filters.ownership !== "library" && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Length</label>
                <Select value={filters.length} onValueChange={(value) => setFilters((prev) => ({ ...prev, length: value as TbrFilters["length"] }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select length" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Any">Any</SelectItem>
                    <SelectItem value="<250">&lt;250 pages</SelectItem>
                    <SelectItem value="250-400">250-400 pages</SelectItem>
                    <SelectItem value="400+">400+ pages</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button onClick={() => void applyFilters()} disabled={loadingExternal}>
              {loadingExternal ? "Loading candidates..." : "Apply filters"}
            </Button>

            <div className="text-sm text-muted-foreground">
              Matching books: {filtered.length}
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          {loadingExternal ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-8 text-center">
              <h3 className="font-display text-xl font-bold mb-2">Building your candidate wheel</h3>
              <p className="text-sm text-muted-foreground font-body mb-4">
                Generating non-owned recommendations and enriching metadata.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-8 text-center">
              <h3 className="font-display text-xl font-bold mb-2">No matches yet</h3>
              <p className="text-sm text-muted-foreground font-body mb-4">
                Try loosening your filters or add more TBR books.
              </p>
            </div>
          ) : (
            <>
              <Card className="border-border/60 bg-card/80">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
                        Wheel
                      </div>
                      <h3 className="font-display text-xl font-bold mt-1">Spin your TBR</h3>
                    </div>
                    <Button onClick={spin} disabled={spinning || wheelBooks.length === 0}>
                      <RotateCw className="w-4 h-4 mr-2" />
                      {spinning ? "Spinning..." : "Spin"}
                    </Button>
                  </div>
                  <div className="relative mx-auto mt-2 h-64 w-64 rounded-full border border-border/60 bg-background/70 overflow-hidden">
                    <div
                      className="absolute inset-0 flex items-center justify-center transition-transform ease-out"
                      style={{ transform: `rotate(${rotation}deg)`, transitionDuration: `${spinDuration}ms` }}
                    >
                      <ul className="absolute inset-0">
                        {wheelBooks.map((book, index) => {
                          const angle = (360 / wheelBooks.length) * index;
                          return (
                            <li
                              key={`${book.title}-${index}`}
                              className="absolute left-1/2 top-1/2 origin-[0_0] text-xs text-muted-foreground"
                              style={{ transform: `rotate(${angle}deg) translate(90px) rotate(90deg)` }}
                            >
                              {book.title}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    <div className="absolute top-1/2 left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
                  </div>
                  {filtered.length > WHEEL_MAX && (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        Spinning among a random sample of {WHEEL_MAX} of {filtered.length} matches.
                      </p>
                      <Button size="sm" variant="outline" onClick={refreshSample}>
                        Refresh sample
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {winner && (
                <Card className="border-border/60 bg-card/80">
                  <CardContent className="p-6">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
                      Winner
                    </div>
                    <div className="mt-3 flex gap-4">
                      {winner.thumbnail ? (
                        <img
                          src={winner.thumbnail}
                          alt={winner.title}
                          className="h-24 w-16 rounded-md object-cover"
                        />
                      ) : (
                        <div className="h-24 w-16 rounded-md bg-secondary/60 flex items-center justify-center text-xs text-muted-foreground">
                          <BookOpen className="w-4 h-4" />
                        </div>
                      )}
                      <div>
                        <h3 className="font-display text-xl font-bold">{winner.title}</h3>
                        <p className="text-sm text-muted-foreground">{winner.author}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {appliedFilters.ownership === "library" ? (
                            <Button size="sm" onClick={startReading}>
                              Start Reading
                            </Button>
                          ) : (
                            <Button size="sm" onClick={addWinnerToLibrary}>
                              Add to Library (TBR)
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={spin}>
                            Spin again
                          </Button>
                          <Button size="sm" variant="ghost" onClick={saveToHistory}>
                            Save to Recently Recommended
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
};

export default TbrWheel;
