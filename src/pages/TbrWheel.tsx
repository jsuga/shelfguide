import { useEffect, useMemo, useState } from "react";
import { Sparkles, RotateCw, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  applyTbrFilters,
  pickWinnerIndex,
  sampleForWheel,
  type TbrBook,
  type TbrFilters,
} from "@/lib/tbrWheel";

type LibraryBook = TbrBook & {
  thumbnail?: string | null;
  status?: string | null;
  user_id?: string;
};

const LIBRARY_KEY = "reading-copilot-library";

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
  genre: "Any",
  length: "Any",
  rating: "Any",
};

const TbrWheel = () => {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [filters, setFilters] = useState<TbrFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<TbrFilters>(defaultFilters);
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

  const tbrBooks = useMemo(
    () => books.filter((book) => (book.status || "").toLowerCase() === "tbr"),
    [books]
  );

  const filtered = useMemo(
    () => applyTbrFilters(tbrBooks, appliedFilters),
    [tbrBooks, appliedFilters]
  );

  const displayed = useMemo(() => sampleForWheel(filtered, 30), [filtered]);

  useEffect(() => {
    setWheelBooks(displayed);
  }, [displayed]);

  const applyFilters = () => {
    const next = {
      ...filters,
      rating: filters.rating === ">=4" ? ">=4" : "Any",
    };
    setAppliedFilters(next);
    setWinner(null);
    setRotation(0);
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
              <Select value={filters.genre} onValueChange={(value) => setFilters((prev) => ({ ...prev, genre: value as TbrFilters["genre"] }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select genre" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Any">Any</SelectItem>
                  <SelectItem value="Fantasy">Fantasy</SelectItem>
                  <SelectItem value="Science Fiction">Science Fiction</SelectItem>
                  <SelectItem value="History">History</SelectItem>
                  <SelectItem value="Romance">Romance</SelectItem>
                  <SelectItem value="Thriller">Thriller</SelectItem>
                </SelectContent>
              </Select>
            </div>

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

            <div className="grid gap-2">
              <label className="text-sm font-medium">Rating threshold</label>
              <Select
                value={filters.rating}
                onValueChange={(value) => setFilters((prev) => ({ ...prev, rating: value as TbrFilters["rating"] }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select rating" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Any">Any</SelectItem>
                  <SelectItem value=">=4">&gt;=4 stars</SelectItem>
                </SelectContent>
              </Select>
              {filters.rating !== "Any" && (
                <div className="text-xs text-muted-foreground">
                  Only books with a rating will be included.
                </div>
              )}
            </div>

            <Button onClick={applyFilters}>
              Apply filters
            </Button>

            <div className="text-sm text-muted-foreground">
              Matching books: {filtered.length}
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          {filtered.length === 0 ? (
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
                  {filtered.length > 30 && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Showing a randomized subset of 30 books for the wheel.
                    </p>
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
                          <Button size="sm" onClick={startReading}>
                            Start Reading
                          </Button>
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
