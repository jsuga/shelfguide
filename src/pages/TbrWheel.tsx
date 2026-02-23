import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { RotateCw, BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  enqueueLibrarySync,
  flushAllPendingSync,
  getAuthenticatedUserId,
  retryAsync,
} from "@/lib/cloudSync";
import {
  applyTbrFilters,
  getDistinctGenres,
  pickWinnerIndex,
  sampleForWheel,
  type TbrBook,
  type TbrFilters,
  TBR_WHEEL_GENRES,
  type TbrFirstInSeriesFilter,
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


const normalize = (value: string) => value.trim().toLowerCase();

const getSelectedGenres = (filters: TbrFilters) => filters.genres.filter((g) => g !== "Any");

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

const describeArc = (cx: number, cy: number, outerR: number, innerR: number, startAngle: number, endAngle: number) => {
  const outerStart = polarToCartesian(cx, cy, outerR, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    `Z`,
  ].join(" ");
};

const TbrWheel = () => {
  const navigate = useNavigate();
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [fullScreenSpin, setFullScreenSpin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [filters, setFilters] = useState<TbrFilters>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<TbrFilters>(defaultFilters);
  const [externalCandidates] = useState<LibraryBook[]>([]);
  const [sampleNonce, setSampleNonce] = useState(0);
  const [wheelBooks, setWheelBooks] = useState<LibraryBook[]>([]);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<LibraryBook | null>(null);
  const [spinDuration, setSpinDuration] = useState(2800);
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);
  // Multi-genre selection
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

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

  // Update filters when genre selection changes
  useEffect(() => {
    if (selectedGenres.length === 0) {
      setFilters((prev) => ({ ...prev, genres: ["Any"] }));
    } else {
      setFilters((prev) => ({ ...prev, genres: selectedGenres }));
    }
  }, [selectedGenres]);

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres((prev) => {
      if (prev.includes(genre)) return prev.filter((g) => g !== genre);
      return [...prev, genre];
    });
  }, []);

  const selectAllGenres = useCallback(() => {
    setSelectedGenres([]);
  }, []);

  const sourceBooks = useMemo(() => {
    return books.filter((b) => normalize(b.status || "") === "tbr" || normalize(b.status || "") === "want_to_read" || normalize(b.status || "") === "to-read");
  }, [books]);

  const filtered = useMemo(() => applyTbrFilters(sourceBooks, appliedFilters), [sourceBooks, appliedFilters]);
  const displayed = useMemo(() => { void sampleNonce; return sampleForWheel(filtered, WHEEL_MAX); }, [filtered, sampleNonce]);
  useEffect(() => { setWheelBooks(displayed); }, [displayed]);

  const refreshSample = () => { setSampleNonce((v) => v + 1); setWinner(null); setRotation(0); };

  const applyFilters = () => {
    const next = { ...filters, ownership: "library" as const, length: "Any" as const };
    setAppliedFilters(next);
    setWinner(null); setRotation(0); setSampleNonce((v) => v + 1);
  };

  /**
   * Angle convention:
   * - The wheel SVG rotates clockwise via CSS transform rotate(Ndeg).
   * - The pointer is at the TOP (12 o'clock / 0°).
   * - Slice 0 starts at 0° and spans sliceAngle degrees clockwise.
   * - When the wheel is rotated by R degrees, the slice under the pointer is
   *   determined by: effectiveAngle = (360 - (R % 360)) % 360, then
   *   index = floor(effectiveAngle / sliceAngle).
   */

  /** Normalize any angle to [0, 360) */
  const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

  /** Get the slice index from a given wheel rotation angle */
  const getIndexFromAngle = (rotationDeg: number, count: number) => {
    if (count <= 0) return -1;
    const sliceAngle = 360 / count;
    const effective = normalizeAngle(360 - normalizeAngle(rotationDeg));
    return Math.floor(effective / sliceAngle) % count;
  };

  /** Get the rotation angle that lands the pointer at the CENTER of the given slice index */
  const getAngleForIndexCenter = (index: number, count: number) => {
    if (count <= 0) return 0;
    const sliceAngle = 360 / count;
    // Center of slice `index` is at (index * sliceAngle + sliceAngle / 2) degrees.
    // To put that under the top pointer, rotate by: 360 - (index * sliceAngle + sliceAngle / 2)
    return normalizeAngle(360 - (index * sliceAngle + sliceAngle / 2));
  };

  // Spin: opens full-screen AND starts animation immediately
  const spin = () => {
    if (wheelBooks.length === 0 || spinning) return;
    setWinner(null); // Clear previous winner — result only shown after animation ends
    setFullScreenSpin(true);

    // 1. Pick a target index first
    const winnerIndex = pickWinnerIndex(wheelBooks.length);

    // 2. Compute the exact landing angle that centers this slice under the pointer
    const landingAngle = getAngleForIndexCenter(winnerIndex, wheelBooks.length);

    // 3. Add full rotations for visual spin effect. Normalize base to avoid float drift.
    const baseRotation = normalizeAngle(rotation);
    const turns = 4 + Math.floor(Math.random() * 2);
    const targetRotation = baseRotation + turns * 360 + landingAngle;

    setSpinDuration(3200);
    // Use requestAnimationFrame to ensure modal is rendered before spin starts
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRotation(targetRotation);
        setSpinning(true);
      });
    });
    setTimeout(() => {
      // Derive winner deterministically from the final angle as single source of truth
      const resolvedIndex = getIndexFromAngle(targetRotation, wheelBooks.length);
      setWinner(wheelBooks[resolvedIndex] ?? null);
      setSpinning(false);
      // Normalize rotation to prevent float drift on next spin
      setRotation(normalizeAngle(targetRotation));
    }, 3400);
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

  // Render the donut-style wheel with outward-radiating labels
  const renderWheel = (wcx: number, wcy: number, wr: number, large: boolean) => {
    const innerR = wr * 0.22; // donut hole
    return (
      <div className="relative mx-auto mt-2 w-full" style={{ maxWidth: wcx * 2, aspectRatio: "1/1" }}>
        {/* Pointer at top */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
          <div className={`w-0 h-0 border-l-transparent border-r-transparent border-t-primary ${large ? "border-l-[14px] border-r-[14px] border-t-[24px]" : "border-l-[10px] border-r-[10px] border-t-[18px]"}`} />
        </div>
        <svg viewBox={`0 0 ${wcx * 2} ${wcy * 2}`} className="w-full h-full"
          style={{ transform: `rotate(${rotation}deg)`, transition: spinning ? `transform ${spinDuration}ms cubic-bezier(0.17, 0.67, 0.12, 0.99)` : 'none' }}>
          {wheelBooks.map((book, i) => {
            const anglePer = 360 / wheelBooks.length;
            const startAngle = i * anglePer;
            const endAngle = startAngle + anglePer;
            const midAngle = startAngle + anglePer / 2;
            const isWinner = !spinning && winner && winner.title === book.title;

            // Label along the radius: start near inner edge, extend outward
            // Text is placed at midpoint of slice angle, rotated to read from center outward
            const labelR = innerR + (wr - innerR) * 0.15; // start just outside inner ring
            const labelEnd = wr * 0.92; // end near outer edge
            const availableLength = labelEnd - labelR;

            // Estimate max chars based on available arc length and font size
            const fontSize = large
              ? (wheelBooks.length > 20 ? 9 : wheelBooks.length > 12 ? 11 : 13)
              : (wheelBooks.length > 20 ? 6 : wheelBooks.length > 12 ? 8 : 10);
            const charWidth = fontSize * 0.55;
            const maxChars = Math.max(4, Math.floor(availableLength / charWidth));
            const label = book.title.length > maxChars ? book.title.slice(0, maxChars - 1) + "…" : book.title;

            // Place text at label start position, rotated so text reads outward along the radius
            const textAngleCSS = midAngle; // rotation in SVG coordinate space

            return (
              <g key={`${book.title}-${i}`}>
                <path
                  d={describeArc(wcx, wcy, wr, innerR, startAngle, endAngle)}
                  fill={sliceColors[i]}
                  stroke="hsl(var(--background))"
                  strokeWidth="1.5"
                  opacity={isWinner ? 1 : 0.88}
                />
                {/* Radial label: text flows from center outward */}
                <text
                  x={wcx}
                  y={wcy}
                  textAnchor="start"
                  dominantBaseline="central"
                  fill="white"
                  fontSize={fontSize}
                  fontWeight="600"
                  style={{ textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}
                  transform={`rotate(${textAngleCSS - 90}, ${wcx}, ${wcy}) translate(${labelR}, 0)`}
                >
                  {label}
                </text>
              </g>
            );
          })}
          {/* Center hub circle */}
          <circle cx={wcx} cy={wcy} r={innerR} fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeWidth="2" />
          <text x={wcx} y={wcy} textAnchor="middle" dominantBaseline="central" fill="hsl(var(--muted-foreground))" fontSize={large ? 12 : 9} fontWeight="700">
            TBR
          </text>
        </svg>
      </div>
    );
  };

  // Responsive wheel sizes
  const cx = 150, cy = 150, r = 140;
  const fsCx = 220, fsCy = 220, fsR = 210;

  return (
    <>
    {/* Full-screen spin overlay */}
    {fullScreenSpin && (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center p-4">
        <Button variant="ghost" size="icon" className="absolute top-4 right-4" onClick={() => setFullScreenSpin(false)}>
          <X className="w-6 h-6" />
        </Button>
        <h2 className="font-display text-2xl font-bold mb-4">Spin your TBR</h2>
        <div className="w-full max-w-[min(440px,92vw)] max-h-[55vh] mx-auto flex items-center justify-center">
          {renderWheel(fsCx, fsCy, fsR, true)}
        </div>
        {/* Only show result AFTER spin animation ends */}
        {winner && !spinning && (
          <div className="mt-6 text-center animate-in fade-in-0 zoom-in-95 duration-300">
            <h3 className="font-display text-xl font-bold">{winner.title}</h3>
            <p className="text-sm text-muted-foreground">{winner.author}</p>
            <div className="mt-3 flex gap-2 justify-center flex-wrap">
              <Button size="sm" onClick={startReading}>Start Reading</Button>
              <Button size="sm" variant="outline" onClick={() => { setWinner(null); spin(); }}>Spin again</Button>
              <Button size="sm" variant="ghost" onClick={() => setFullScreenSpin(false)}>Close</Button>
            </div>
          </div>
        )}
        {spinning && (
          <p className="mt-6 text-sm text-muted-foreground animate-pulse">Spinning...</p>
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
            {/* Multi-genre selection with checkboxes */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Genres</label>
              <div className="rounded-lg border border-border/60 bg-background/60 p-3 max-h-48 overflow-y-auto">
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <Checkbox
                    checked={selectedGenres.length === 0}
                    onCheckedChange={() => selectAllGenres()}
                  />
                  <span className="text-sm font-medium">All Genres</span>
                </label>
                <div className="border-t border-border/40 pt-2 grid gap-1.5">
                  {genreOptions.genres.map((g) => (
                    <label key={g} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={selectedGenres.includes(g)}
                        onCheckedChange={() => toggleGenre(g)}
                      />
                      <span className="text-sm">{g}</span>
                    </label>
                  ))}
                </div>
              </div>
              {selectedGenres.length > 0 && (
                <p className="text-xs text-muted-foreground">{selectedGenres.length} genre{selectedGenres.length > 1 ? "s" : ""} selected</p>
              )}
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


            <Button onClick={() => void applyFilters()}>Apply filters</Button>
            <div className="text-sm text-muted-foreground">
              Matching books: <strong>{filtered.length}</strong>
              {wheelBooks.length > 0 && wheelBooks.length < filtered.length && (
                <span className="ml-1">({wheelBooks.length} on wheel)</span>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-4">
          {filtered.length === 0 ? (
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

                  {/* Inline SVG Wheel (small preview) — responsive container */}
                  <div className="w-full max-w-[min(300px,92vw)] mx-auto">
                    {renderWheel(cx, cy, r, false)}
                  </div>

                  {filtered.length > WHEEL_MAX && (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">Spinning among a random sample of {WHEEL_MAX} of {filtered.length} matches.</p>
                      <Button size="sm" variant="outline" onClick={refreshSample}>Refresh sample</Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {winner && !fullScreenSpin && (
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
                          <Button size="sm" onClick={startReading}>Start Reading</Button>
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
    </>
  );
};

export default TbrWheel;
