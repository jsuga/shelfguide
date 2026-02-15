import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, RotateCw, BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  enqueueLibrarySync,
  flushAllPendingSync,
  getAuthenticatedUserId,
  retryAsync,
  upsertBooksToCloud,
} from "@/lib/cloudSync";
import {
  applyTbrFilters,
  dedupeCandidatesAgainstOwned,
  getDistinctGenres,
  pickWinnerIndex,
  sampleForWheel,
  type TbrBook,
  type TbrFilters,
  TBR_WHEEL_GENRES,
  type TbrFirstInSeriesFilter,
  type TbrOwnershipMode,
} from "@/lib/tbrWheel";

const db = supabase as any;

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
  try { return JSON.parse(stored) as LibraryBook[]; } catch { return []; }
};
const setLocalBooks = (books: LibraryBook[]) => { localStorage.setItem(LIBRARY_KEY, JSON.stringify(books)); };

const defaultFilters: TbrFilters = { genres: ["Any"], firstInSeries: "any", ownership: "library", length: "Any" };

type CopilotRecommendation = { id: string; title: string; author: string; genre: string };
const normalize = (value: string) => value.trim().toLowerCase();

const getSelectedGenres = (filters: TbrFilters) => filters.genres.filter((g) => g !== "Any");

const buildCopilotPrompts = (filters: TbrFilters) => {
  const selectedGenres = getSelectedGenres(filters);
  const genrePrompt = selectedGenres.length > 0 ? `genres: ${selectedGenres.join(", ")}` : "genres: broad mix";
  const firstPrompt = filters.firstInSeries === "first_only" ? "prefer first books in series" : filters.firstInSeries === "not_first" ? "prefer standalones or not-first-in-series books" : "series position: any";
  return [
    `tbr recommendations, ${genrePrompt}, ${firstPrompt}`,
    `reader wants new picks, ${genrePrompt}, ${firstPrompt}`,
    `recommend outside owned library, ${genrePrompt}, ${firstPrompt}`,
    `discoverable books for reading next, ${genrePrompt}, ${firstPrompt}`,
  ];
};

const parseGoogleBook = (payload: unknown) => {
  const data = payload as { items?: Array<{ volumeInfo?: { categories?: string[]; pageCount?: number; imageLinks?: { thumbnail?: string }; industryIdentifiers?: Array<{ type?: string; identifier?: string }> } }> };
  const first = data?.items?.[0]?.volumeInfo;
  if (!first) return null;
  const identifiers = first.industryIdentifiers || [];
  const isbn13 = identifiers.find((e) => normalize(e.type || "") === "isbn_13")?.identifier || null;
  const isbn = identifiers.find((e) => normalize(e.type || "") === "isbn_10")?.identifier || null;
  return { categories: first.categories || [], page_count: first.pageCount ?? null, thumbnail: first.imageLinks?.thumbnail || null, isbn, isbn13 };
};

const enrichFromGoogleBooks = async (book: CopilotRecommendation) => {
  const query = `intitle:${book.title} inauthor:${book.author}`;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query); url.searchParams.set("maxResults", "1"); url.searchParams.set("printType", "books"); url.searchParams.set("langRestrict", "en");
  try { const res = await fetch(url.toString()); if (!res.ok) return null; return parseGoogleBook(await res.json()); } catch { return null; }
};

// SVG Wheel helpers
const generateSliceColors = (count: number): string[] => {
  const style = getComputedStyle(document.documentElement);
  const primaryHue = parseFloat(style.getPropertyValue("--primary")?.split(" ")[0]) || 220;
  return Array.from({ length: count }, (_, i) => {
    const hue = (primaryHue + (i * 360 / count) + i * 17) % 360;
    const sat = 55 + (i % 3) * 10;
    const light = 42 + (i % 2) * 12;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  });
};

const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const describeArc = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y} Z`;
};

const TbrWheel = () => {
  const navigate = useNavigate();
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [fullScreenSpin, setFullScreenSpin] = useState(false);
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
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string>("All Genres");

  // Dynamic genre list
  const genreOptions = useMemo(() => {
    const userGenres = getDistinctGenres(books);
    if (userGenres.length > 0) return { genres: userGenres, isUserGenres: true };
    return { genres: [...TBR_WHEEL_GENRES], isUserGenres: false };
  }, [books]);

  const loadBooks = async (userIdValue: string | null) => {
    if (!userIdValue) { setBooks(getLocalBooks()); return; }
    const result: any = await retryAsync(() => db.from("books").select("*").eq("user_id", userIdValue), 1, 350);
    const { data, error } = result;
    if (error) { setCloudNotice("Cloud sync is unavailable — using local-only data for now."); setBooks(getLocalBooks()); return; }
    setCloudNotice(null);
    setBooks((data || []) as LibraryBook[]);
  };

  useEffect(() => {
    const init = async () => { const uid = await getAuthenticatedUserId(); setUserId(uid); await loadBooks(uid); await flushAllPendingSync(); };
    void init();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null; setUserId(user?.id ?? null);
      void loadBooks(user?.id ?? null);
      if (user?.id) void flushAllPendingSync();
    });
    return () => { listener.subscription.unsubscribe(); };
  }, []);

  // Update filters when genre dropdown changes
  useEffect(() => {
    if (selectedGenre === "All Genres") {
      setFilters((prev) => ({ ...prev, genres: ["Any"] }));
    } else {
      setFilters((prev) => ({ ...prev, genres: [selectedGenre] }));
    }
  }, [selectedGenre]);

  const sourceBooks = useMemo(() => {
    if (appliedFilters.ownership === "library") return books.filter((b) => normalize(b.status || "") === "tbr");
    return externalCandidates;
  }, [appliedFilters.ownership, books, externalCandidates]);

  const filtered = useMemo(() => applyTbrFilters(sourceBooks, appliedFilters), [sourceBooks, appliedFilters]);
  const displayed = useMemo(() => { void sampleNonce; return sampleForWheel(filtered, WHEEL_MAX); }, [filtered, sampleNonce]);
  useEffect(() => { setWheelBooks(displayed); }, [displayed]);

  const refreshSample = () => { setSampleNonce((v) => v + 1); setWinner(null); setRotation(0); };

  const loadExternalCandidates = async (nextFilters: TbrFilters) => {
    if (!userId) { setExternalCandidates([]); toast.error("Sign in to get recommendations outside your library."); return; }
    setLoadingExternal(true);
    const prompts = buildCopilotPrompts(nextFilters);
    const results = await Promise.all(prompts.map(async (prompt) => {
      const { data, error } = await supabase.functions.invoke("reading-copilot", { body: { prompt, tags: getSelectedGenres(nextFilters).map((g) => normalize(g)), surprise: 55, limit: 6 } });
      if (error) return [] as CopilotRecommendation[];
      return (data?.recommendations || []) as CopilotRecommendation[];
    }));
    const flat = results.flat();
    if (flat.length === 0) { setExternalCandidates([]); setLoadingExternal(false); toast.error("Could not load recommendation candidates from Copilot."); return; }
    const enriched = await Promise.all(flat.map(async (c) => {
      const meta = await enrichFromGoogleBooks(c);
      return { id: c.id, title: c.title, author: c.author, genre: meta?.categories?.[0] || c.genre || null, status: "tbr", is_first_in_series: false, series_name: null, page_count: meta?.page_count ?? null, thumbnail: meta?.thumbnail || null, isbn: meta?.isbn || null, isbn13: meta?.isbn13 || null, source: "copilot_recommendation" } as LibraryBook;
    }));
    const deduped = dedupeCandidatesAgainstOwned(enriched, books);
    setExternalCandidates(deduped); setLoadingExternal(false);
    if (deduped.length === 0) toast.error("No non-owned recommendations matched your filters.");
  };

  const applyFilters = async () => {
    const next = { ...filters, length: filters.ownership === "library" ? "Any" as const : filters.length };
    setAppliedFilters(next);
    if (next.ownership === "not_owned") await loadExternalCandidates(next);
    setWinner(null); setRotation(0); setSampleNonce((v) => v + 1);
  };

  const spin = () => {
    if (wheelBooks.length === 0 || spinning) return;
    setFullScreenSpin(true);
    const winnerIndex = pickWinnerIndex(wheelBooks.length);
    const anglePer = 360 / wheelBooks.length;
    const turns = 3;
    const targetRotation = rotation + turns * 360 + (360 - winnerIndex * anglePer - anglePer / 2);
    setSpinDuration(2800); setRotation(targetRotation); setSpinning(true);
    setTimeout(() => { setWinner(wheelBooks[winnerIndex] ?? null); setSpinning(false); }, 2800);
  };

  const addWinnerToLibrary = async () => {
    if (!winner) return;
    const payload = { title: winner.title, author: winner.author, genre: winner.genre || "", series_name: winner.series_name || null, is_first_in_series: winner.is_first_in_series === true, status: "tbr", page_count: winner.page_count ?? null, thumbnail: winner.thumbnail || null, isbn: winner.isbn || null, isbn13: winner.isbn13 || null, source: winner.source || "tbr_wheel" };
    if (userId) {
      const { error } = await upsertBooksToCloud(userId, [payload]);
      if (error) { enqueueLibrarySync(userId, [payload], "tbr_wheel_add"); setCloudNotice("TBR add queued for cloud sync."); return; }
      await loadBooks(userId);
      setExternalCandidates((cur) => cur.filter((e) => !(normalize(e.title) === normalize(winner.title) && normalize(e.author) === normalize(winner.author))));
      toast.success("Added to your library as TBR."); return;
    }
    const nextBooks = [{ ...payload }, ...books]; setBooks(nextBooks); setLocalBooks(nextBooks);
    toast.success("Added to your local library as TBR.");
  };

  const startReading = async () => {
    if (!winner) return;
    const updatedBook = { ...winner, status: "reading" };
    // Optimistic local update
    const next = books.map((b) => b.title === winner.title && b.author === winner.author ? { ...b, status: "reading" } : b);
    setBooks(next); setLocalBooks(next);
    if (userId && winner.id) {
      const { error } = await db.from("books").update({ status: "reading" }).eq("id", winner.id);
      if (error) {
        if (import.meta.env.DEV) console.warn("[ShelfGuide] startReading cloud update failed, queuing:", error.message);
        enqueueLibrarySync(userId, [updatedBook], "tbr_wheel_start_reading");
      }
      await loadBooks(userId);
    } else if (userId) {
      // Has userId but no book.id — queue for sync
      enqueueLibrarySync(userId, [updatedBook], "tbr_wheel_start_reading");
    }
    toast.success("Marked as Reading", {
      action: { label: "View in Library", onClick: () => navigate("/library") },
    });
  };

  const saveToHistory = async () => {
    if (!winner || !userId) return;
    const { error } = await db.from("copilot_recommendations").insert({ user_id: userId, book_id: winner.id ?? null, title: winner.title, author: winner.author, genre: winner.genre ?? null, tags: [], summary: null, source: "tbr_wheel", reasons: ["Selected via TBR Wheel."], why_new: null });
    if (error) { toast.error("Could not save to history."); return; }
    toast.success("Saved to recently recommended.");
  };

  const sliceColors = useMemo(() => generateSliceColors(wheelBooks.length), [wheelBooks.length]);
  const cx = 130, cy = 130, r = 120;
  const fsCx = 200, fsCy = 200, fsR = 190;

  const renderWheel = (wcx: number, wcy: number, wr: number, large: boolean) => (
    <div className="relative mx-auto mt-2" style={{ width: wcx * 2, height: wcy * 2 }}>
      {/* Pointer */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
        <div className={`w-0 h-0 border-l-transparent border-r-transparent border-t-primary ${large ? "border-l-[14px] border-r-[14px] border-t-[24px]" : "border-l-[10px] border-r-[10px] border-t-[18px]"}`} />
      </div>
      <svg width={wcx * 2} height={wcy * 2} viewBox={`0 0 ${wcx * 2} ${wcy * 2}`}
        style={{ transform: `rotate(${rotation}deg)`, transition: `transform ${spinDuration}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)` }}>
        {wheelBooks.map((book, i) => {
          const anglePer = 360 / wheelBooks.length;
          const startAngle = i * anglePer;
          const endAngle = startAngle + anglePer;
          const midAngle = startAngle + anglePer / 2;
          // Label starts near center (30% radius) and extends outward
          const labelStartR = wr * 0.22;
          const labelPos = polarToCartesian(wcx, wcy, labelStartR, midAngle);
          const maxChars = large
            ? Math.max(10, Math.floor(anglePer / 1.8))
            : Math.max(6, Math.floor(anglePer / 3));
          const label = book.title.length > maxChars ? book.title.slice(0, maxChars - 1) + "…" : book.title;
          const isWinner = !spinning && winner && winner.title === book.title;
          const fontSize = large
            ? (wheelBooks.length > 15 ? 9 : wheelBooks.length > 8 ? 12 : 14)
            : (wheelBooks.length > 15 ? 7 : wheelBooks.length > 8 ? 9 : 11);
          return (
            <g key={`${book.title}-${i}`}>
              <path d={describeArc(wcx, wcy, wr, startAngle, endAngle)} fill={sliceColors[i]} stroke="hsl(var(--background))" strokeWidth="1.5"
                opacity={isWinner ? 1 : 0.85} />
              <text x={labelPos.x} y={labelPos.y} textAnchor="start" dominantBaseline="central"
                fill="white" fontSize={fontSize}
                fontWeight="600" transform={`rotate(${midAngle}, ${labelPos.x}, ${labelPos.y})`}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );

  return (
    <>
    {/* Full-screen spin modal */}
    {fullScreenSpin && (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center">
        <Button variant="ghost" size="icon" className="absolute top-4 right-4" onClick={() => setFullScreenSpin(false)}>
          <X className="w-6 h-6" />
        </Button>
        <h2 className="font-display text-2xl font-bold mb-4">Spin your TBR</h2>
        {renderWheel(fsCx, fsCy, fsR, true)}
        {winner && !spinning && (
          <div className="mt-6 text-center">
            <h3 className="font-display text-xl font-bold">{winner.title}</h3>
            <p className="text-sm text-muted-foreground">{winner.author}</p>
            <div className="mt-3 flex gap-2 justify-center">
              {appliedFilters.ownership === "library" ? (
                <Button size="sm" onClick={startReading}>Start Reading</Button>
              ) : (
                <Button size="sm" onClick={addWinnerToLibrary}>Add to Library (TBR)</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { setWinner(null); spin(); }}>Spin again</Button>
              <Button size="sm" variant="ghost" onClick={() => setFullScreenSpin(false)}>Close</Button>
            </div>
          </div>
        )}
      </div>
    )}
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">TBR Wheel</h1>
        <p className="text-muted-foreground mt-2 font-body">Reduce decision fatigue and spin your next read.</p>
      </div>
      {cloudNotice && <div className="mb-4 rounded-lg border border-border/60 bg-card/60 px-4 py-2 text-xs text-muted-foreground">{cloudNotice}</div>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl border border-border/60 bg-card/70 p-6">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">Filters</div>
          <div className="mt-4 grid gap-4">
            {/* Genre dropdown */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Genre</label>
              <Select value={selectedGenre} onValueChange={setSelectedGenre}>
                <SelectTrigger><SelectValue placeholder="Select genre" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All Genres">All Genres</SelectItem>
                  {genreOptions.genres.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
              {!genreOptions.isUserGenres && (
                <p className="text-xs text-muted-foreground/70 italic">These are starter genres. Import your library to see your personal genres.</p>
              )}
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">First in series</label>
              <Select value={filters.firstInSeries} onValueChange={(v) => setFilters((p) => ({ ...p, firstInSeries: v as TbrFirstInSeriesFilter }))}>
                <SelectTrigger><SelectValue placeholder="Series filter" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="first_only">First in series only</SelectItem>
                  <SelectItem value="not_first">Not first in series</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Ownership</label>
              <Select value={filters.ownership} onValueChange={(v) => setFilters((p) => ({ ...p, ownership: v as TbrOwnershipMode, length: v === "library" ? "Any" : p.length }))}>
                <SelectTrigger><SelectValue placeholder="Select ownership mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="library">In my library</SelectItem>
                  <SelectItem value="not_owned">Not owned / recommend outside my library</SelectItem>
                </SelectContent>
              </Select>
              {filters.ownership === "not_owned" && <div className="text-xs text-muted-foreground">In-library mode always spins from your TBR books.</div>}
            </div>

            {filters.ownership !== "library" && (
              <div className="grid gap-2">
                <label className="text-sm font-medium">Length</label>
                <Select value={filters.length} onValueChange={(v) => setFilters((p) => ({ ...p, length: v as TbrFilters["length"] }))}>
                  <SelectTrigger><SelectValue placeholder="Select length" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Any">Any</SelectItem>
                    <SelectItem value="<250">&lt;250 pages</SelectItem>
                    <SelectItem value="250-400">250-400 pages</SelectItem>
                    <SelectItem value="400+">400+ pages</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button onClick={() => void applyFilters()} disabled={loadingExternal}>{loadingExternal ? "Loading candidates..." : "Apply filters"}</Button>
            <div className="text-sm text-muted-foreground">Matching books: {filtered.length}</div>
          </div>
        </section>

        <section className="grid gap-4">
          {loadingExternal ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-8 text-center">
              <h3 className="font-display text-xl font-bold mb-2">Building your candidate wheel</h3>
              <p className="text-sm text-muted-foreground font-body mb-4">Generating non-owned recommendations and enriching metadata.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-8 text-center">
              <h3 className="font-display text-xl font-bold mb-2">No matches yet</h3>
              <p className="text-sm text-muted-foreground font-body mb-4">Try loosening your filters or add more TBR books.</p>
            </div>
          ) : (
            <>
              <Card className="border-border/60 bg-card/80">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">Wheel</div>
                      <h3 className="font-display text-xl font-bold mt-1">Spin your TBR</h3>
                    </div>
                    <Button onClick={spin} disabled={spinning || wheelBooks.length === 0}><RotateCw className="w-4 h-4 mr-2" />{spinning ? "Spinning..." : "Spin"}</Button>
                  </div>

                  {/* Inline SVG Wheel (small preview) */}
                  {renderWheel(cx, cy, r, false)}

                  {filtered.length > WHEEL_MAX && (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">Spinning among a random sample of {WHEEL_MAX} of {filtered.length} matches.</p>
                      <Button size="sm" variant="outline" onClick={refreshSample}>Refresh sample</Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {winner && (
                <Card className="border-border/60 bg-card/80">
                  <CardContent className="p-6">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">Winner</div>
                    <div className="mt-3 flex gap-4">
                      {winner.thumbnail ? (
                        <img src={winner.thumbnail} alt={winner.title} className="h-24 w-16 rounded-md object-cover" />
                      ) : (
                        <div className="h-24 w-16 rounded-md bg-secondary/60 flex items-center justify-center text-xs text-muted-foreground"><BookOpen className="w-4 h-4" /></div>
                      )}
                      <div>
                        <h3 className="font-display text-xl font-bold">{winner.title}</h3>
                        <p className="text-sm text-muted-foreground">{winner.author}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {appliedFilters.ownership === "library" ? (
                            <Button size="sm" onClick={startReading}>Start Reading</Button>
                          ) : (
                            <Button size="sm" onClick={addWinnerToLibrary}>Add to Library (TBR)</Button>
                          )}
                          <Button size="sm" variant="outline" onClick={spin}>Spin again</Button>
                          <Button size="sm" variant="ghost" onClick={saveToHistory}>Save to Recently Recommended</Button>
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
    </>
  );
};

export default TbrWheel;
