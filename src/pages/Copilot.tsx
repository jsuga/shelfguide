import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  ChevronDown,
  MessageSquare,
  RefreshCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  enqueueFeedbackSync,
  enqueueLibrarySync,
  flushAllPendingSync,
  getAuthenticatedUserId,
  recordSyncError,
  retryAsync,
  upsertBooksToCloud,
} from "@/lib/cloudSync";

const db = supabase as any;

type LibraryBook = {
  id?: string;
  title: string;
  author: string;
  genre: string;
  series_name: string | null;
  is_first_in_series: boolean;
  status: string;
  rating?: number | null;
  date_read?: string | null;
};

type Recommendation = {
  id: string;
  title: string;
  author: string;
  genre: string;
  tags: string[];
  summary: string;
  source: string;
  reasons: string[];
  why_new: string;
};

type FeedbackEntry = {
  id?: string;
  book_id: string | null;
  title: string;
  author: string | null;
  genre: string | null;
  tags: string[];
  decision: "accepted" | "rejected";
  reason: string | null;
  note: string | null;
  created_at: string;
};

type FeedbackWeights = {
  genres: Record<string, number>;
  authors: Record<string, number>;
  tags: Record<string, number>;
};

type HistoryEntry = {
  id: string;
  title: string;
  author: string | null;
  genre: string | null;
  source: string | null;
  reasons: string[];
  summary: string | null;
  tags: string[];
  why_new: string | null;
  created_at: string;
};

const LIBRARY_KEY = "reading-copilot-library";
const FEEDBACK_KEY = "reading-copilot-feedback";

const STATUS_WEIGHT: Record<string, number> = {
  finished: 3, reading: 2, paused: 1.5, want_to_read: 1, tbr: 1,
};

const MOOD_TAGS = [
  { id: "cozy", label: "Cozy", keywords: ["cozy", "warm", "comfort", "gentle"] },
  { id: "epic", label: "Epic", keywords: ["epic", "saga", "grand", "sweeping"] },
  { id: "fast", label: "Fast", keywords: ["fast", "quick", "page-turner", "thrill"] },
  { id: "romance", label: "Romance", keywords: ["romance", "love", "heart"] },
  { id: "mystery", label: "Mystery", keywords: ["mystery", "detective", "whodunit"] },
  { id: "space", label: "Space", keywords: ["space", "galaxy", "ship", "planet"] },
  { id: "history", label: "History", keywords: ["history", "war", "biography"] },
  { id: "magic", label: "Magic", keywords: ["magic", "wizard", "spell", "dragon"] },
  { id: "thoughtful", label: "Thoughtful", keywords: ["thoughtful", "literary", "reflective"] },
];

const FALLBACK_CATALOG: Recommendation[] = [
  { id: "fallback-1", title: "The Name of the Wind", author: "Patrick Rothfuss", genre: "Fantasy", tags: ["epic", "magic", "thoughtful"], summary: "A lyrical origin story with music, myth, and a slow-burn mystery.", source: "Local catalog", reasons: [], why_new: "" },
  { id: "fallback-2", title: "Project Hail Mary", author: "Andy Weir", genre: "Science Fiction", tags: ["space", "fast"], summary: "A lone scientist fights to save humanity with science and humor.", source: "Local catalog", reasons: [], why_new: "" },
  { id: "fallback-3", title: "Gone Girl", author: "Gillian Flynn", genre: "Thriller", tags: ["fast", "mystery"], summary: "A dark, twisty look at marriage and media narratives.", source: "Local catalog", reasons: [], why_new: "" },
  { id: "fallback-4", title: "Pride and Prejudice", author: "Jane Austen", genre: "Romance", tags: ["romance", "thoughtful"], summary: "Wit, society, and slow-burn sparks in a timeless classic.", source: "Local catalog", reasons: [], why_new: "" },
  { id: "fallback-5", title: "The Thursday Murder Club", author: "Richard Osman", genre: "Mystery", tags: ["cozy", "mystery"], summary: "Retirees in a quiet village solve crimes with charm and wit.", source: "Local catalog", reasons: [], why_new: "" },
];

const normalize = (value: string) => value.trim().toLowerCase();
const normalizeStatus = (raw: string | null | undefined): string => {
  if (!raw) return "tbr";
  const s = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["tbr", "to_read", "want_to_read"].includes(s)) return "tbr";
  if (["reading", "currently_reading"].includes(s)) return "reading";
  if (["read", "finished"].includes(s)) return "finished";
  if (s === "paused") return "paused";
  return s;
};

const getLocalBooks = (): LibraryBook[] => {
  const stored = localStorage.getItem(LIBRARY_KEY);
  if (!stored) return [];
  try { return JSON.parse(stored) as LibraryBook[]; } catch { return []; }
};

const setLocalBooks = (books: LibraryBook[]) => {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(books));
};

const loadLocalFeedback = (): FeedbackEntry[] => {
  const stored = localStorage.getItem(FEEDBACK_KEY);
  if (!stored) return [];
  try { return JSON.parse(stored) as FeedbackEntry[]; } catch { return []; }
};

const saveLocalFeedback = (entries: FeedbackEntry[]) => {
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries));
};

const derivePromptTags = (prompt: string, selected: string[]) => {
  const derived = MOOD_TAGS.filter((tag) =>
    tag.keywords.some((keyword) => normalize(prompt).includes(keyword))
  ).map((tag) => tag.id);
  return Array.from(new Set([...selected, ...derived]));
};

const buildProfile = (books: LibraryBook[]) => {
  const genreCounts: Record<string, number> = {};
  const authorCounts: Record<string, number> = {};
  const avoidGenres: Record<string, number> = {};
  const avoidAuthors: Record<string, number> = {};

  books.forEach((book) => {
    const normalizedStatus = normalizeStatus(book.status);
    const statusWeight = STATUS_WEIGHT[normalizedStatus] ?? 1;
    const ratingWeight =
      typeof book.rating === "number"
        ? book.rating >= 4
          ? 2.2
          : book.rating >= 3
          ? 1.2
          : book.rating <= 2
          ? 0.4
          : 1
        : 1;
    const weight = statusWeight * ratingWeight;

    if (book.genre) {
      const key = normalize(book.genre);
      genreCounts[key] = (genreCounts[key] ?? 0) + weight;
      if (typeof book.rating === "number" && book.rating <= 2) {
        avoidGenres[key] = (avoidGenres[key] ?? 0) + 1;
      }
    }
    if (book.author) {
      const key = normalize(book.author);
      authorCounts[key] = (authorCounts[key] ?? 0) + weight;
      if (typeof book.rating === "number" && book.rating <= 2) {
        avoidAuthors[key] = (avoidAuthors[key] ?? 0) + 1;
      }
    }
  });
  const sortTop = (map: Record<string, number>, limit = 3) =>
    Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, value]) => ({ key, value }));
  return {
    topGenres: sortTop(genreCounts),
    topAuthors: sortTop(authorCounts),
    avoidGenres: sortTop(avoidGenres, 3),
    avoidAuthors: sortTop(avoidAuthors, 3),
  };
};

type TasteSummary = {
  hasRatings: boolean;
  topRatedGenres: Array<{ key: string; value: number }>;
  topRatedAuthors: Array<{ key: string; value: number }>;
  recentFinished: Array<{ title: string; author: string; rating: number | null }>;
  avoidGenres: Array<{ key: string; value: number }>;
  avoidAuthors: Array<{ key: string; value: number }>;
  statusDist: Record<string, number>;
  fallbackGenres: Array<{ key: string; value: number }>;
};

const buildTasteSummary = (books: LibraryBook[]): TasteSummary => {
  const rated = books.filter((b) => typeof b.rating === "number" && b.rating > 0);
  const topRated = rated.filter((b) => (b.rating ?? 0) >= 4);
  const lowRated = rated.filter((b) => (b.rating ?? 0) <= 2);
  const statusDist: Record<string, number> = {};
  const fallbackGenreCounts: Record<string, number> = {};

  books.forEach((book) => {
    const statusKey = normalizeStatus(book.status);
    statusDist[statusKey] = (statusDist[statusKey] ?? 0) + 1;
    if (book.genre) {
      const key = normalize(book.genre);
      fallbackGenreCounts[key] = (fallbackGenreCounts[key] ?? 0) + 1;
    }
  });

  const countTop = (items: LibraryBook[], field: "genre" | "author") => {
    const map: Record<string, number> = {};
    items.forEach((book) => {
      const raw = field === "genre" ? book.genre : book.author;
      if (!raw) return;
      const key = normalize(raw);
      const ratingWeight = (book.rating ?? 0) >= 4 ? 2 : 1;
      map[key] = (map[key] ?? 0) + ratingWeight;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, value]) => ({ key, value }));
  };

  const recentFinished = books
    .filter((b) => normalizeStatus(b.status) === "finished")
    .slice(0, 6)
    .sort((a, b) => {
      const aDate = a.date_read ? new Date(a.date_read).getTime() : 0;
      const bDate = b.date_read ? new Date(b.date_read).getTime() : 0;
      return bDate - aDate;
    })
    .slice(0, 3)
    .map((b) => ({ title: b.title, author: b.author, rating: b.rating ?? null }));

  const avoidGenres = countTop(lowRated, "genre");
  const avoidAuthors = countTop(lowRated, "author");

  return {
    hasRatings: rated.length > 0,
    topRatedGenres: countTop(topRated, "genre"),
    topRatedAuthors: countTop(topRated, "author"),
    recentFinished,
    avoidGenres,
    avoidAuthors,
    statusDist,
    fallbackGenres: Object.entries(fallbackGenreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, value]) => ({ key, value })),
  };
};

const computeFeedbackWeights = (entries: FeedbackEntry[]): FeedbackWeights => {
  const weights: FeedbackWeights = { genres: {}, authors: {}, tags: {} };
  entries.forEach((entry) => {
    const delta = entry.decision === "accepted" ? 2 : -1;
    if (entry.genre) { const key = normalize(entry.genre); weights.genres[key] = (weights.genres[key] ?? 0) + delta; }
    if (entry.author) { const key = normalize(entry.author); weights.authors[key] = (weights.authors[key] ?? 0) + delta; }
    entry.tags.forEach((tag) => { weights.tags[tag] = (weights.tags[tag] ?? 0) + delta; });
  });
  return weights;
};

const scoreFallback = (catalog: Recommendation[], books: LibraryBook[], feedback: FeedbackWeights, promptTags: string[], surprise: number) => {
  const profile = buildProfile(books);
  const excluded = new Set(books.map((book) => normalize(book.title)));
  const surpriseBoost = Math.max(0, Math.min(100, surprise)) / 100;
  return catalog
    .filter((book) => !excluded.has(normalize(book.title)))
    .map((book) => {
      const genreKey = normalize(book.genre);
      const authorKey = normalize(book.author);
      const genreWeight = profile.topGenres.find((e) => e.key === genreKey)?.value ?? 0;
      const authorWeight = profile.topAuthors.find((e) => e.key === authorKey)?.value ?? 0;
      const feedbackBoost = (feedback.genres[genreKey] ?? 0) + (feedback.authors[authorKey] ?? 0);
      const moodBoost = book.tags.filter((tag) => promptTags.includes(tag)).length * 1.5;
      const diversityPenalty = profile.topGenres.some((e) => e.key === genreKey) ? (1 - surpriseBoost) * 1.5 : 0;
      const avoidPenalty =
        (profile.avoidGenres.some((e) => e.key === genreKey) ? 2 : 0) +
        (profile.avoidAuthors.some((e) => e.key === authorKey) ? 2 : 0);
      const score = genreWeight * 0.7 + authorWeight * 1.2 + feedbackBoost * 0.6 + moodBoost + Math.random() * 0.2 - diversityPenalty - avoidPenalty;
      return { book, score, reasons: ["A steady fallback pick based on your library.", "Matches the mood signals you provided."], why_new: "A balanced option outside your current shelf." };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => ({ ...entry.book, reasons: entry.reasons, why_new: entry.why_new }));
};

const Copilot = () => {
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [surprise, setSurprise] = useState(35);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryEntry | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [cloudNotice, setCloudNotice] = useState<string | null>(null);

  const promptTags = useMemo(() => derivePromptTags(prompt, selectedTags), [prompt, selectedTags]);
  const profile = useMemo(() => buildProfile(books), [books]);
  const tasteSummary = useMemo(() => buildTasteSummary(books), [books]);
  const feedbackWeights = useMemo(() => computeFeedbackWeights(feedbackEntries), [feedbackEntries]);

  const loadBooks = async (userIdValue: string | null) => {
    if (!userIdValue) { setBooks(getLocalBooks()); return; }
    setLoadingLibrary(true);
    const result: any = await retryAsync(
      () => db.from("books").select("*").eq("user_id", userIdValue).order("created_at", { ascending: false }),
      1, 350
    );
    const { data, error } = result;
    setLoadingLibrary(false);
    if (error) {
      const syncError = await recordSyncError({ error, operation: "select", table: "books", userId: userIdValue });
      setCloudNotice(syncError.userMessage || "Cloud sync is unavailable. Using local-only data for now.");
      setBooks(getLocalBooks());
      return;
    }
    setCloudNotice(null);
    const cloudBooks = (data || []) as LibraryBook[];
    setBooks(cloudBooks);
    const localBooks = getLocalBooks();
    if (cloudBooks.length === 0 && localBooks.length > 0 && userIdValue) {
      const { error: insertError } = await db.from("books").insert(localBooks.map((book: LibraryBook) => { const { dedupe_key, created_at, updated_at, ...rest } = book as any; return { ...rest, user_id: userIdValue }; }));
      if (!insertError) {
        setLocalBooks([]);
        const { data: refreshed } = await db.from("books").select("*").eq("user_id", userIdValue).order("created_at", { ascending: false });
        setBooks((refreshed || []) as LibraryBook[]);
        toast.success("Migrated your local library to the cloud.");
      }
    }
  };

  const loadFeedback = async (userIdValue: string | null) => {
    if (!userIdValue) { setFeedbackEntries(loadLocalFeedback()); return; }
    const result: any = await retryAsync(
      () => db.from("copilot_feedback").select("*").eq("user_id", userIdValue).order("created_at", { ascending: false }).limit(50),
      1, 350
    );
    const { data, error } = result;
    if (error) {
      const syncError = await recordSyncError({ error, operation: "select", table: "copilot_feedback", userId: userIdValue });
      setCloudNotice(syncError.userMessage || "Feedback sync paused. Using local cache.");
      setFeedbackEntries(loadLocalFeedback());
      return;
    }
    setFeedbackEntries((data || []) as FeedbackEntry[]);
  };

  const loadHistory = async (userIdValue: string | null) => {
    if (!userIdValue) { setHistoryEntries([]); return; }
    setLoadingHistory(true);
    const result: any = await retryAsync(
      () => db.from("copilot_recommendations").select("id,title,author,genre,source,reasons,summary,tags,why_new,created_at").eq("user_id", userIdValue).order("created_at", { ascending: false }).limit(50),
      1, 350
    );
    const { data, error } = result;
    setLoadingHistory(false);
    if (error) {
      const syncError = await recordSyncError({ error, operation: "select", table: "copilot_recommendations", userId: userIdValue });
      setCloudNotice(syncError.userMessage || "Recommendation history unavailable right now.");
      return;
    }
    setHistoryEntries((data || []) as HistoryEntry[]);
  };

  const clearHistory = async () => {
    if (!userId) { setHistoryEntries([]); return; }
    const { error } = await db.from("copilot_recommendations").delete().eq("user_id", userId);
    if (error) {
      await recordSyncError({ error, operation: "delete", table: "copilot_recommendations", userId });
      toast.error("Could not clear history.");
      return;
    }
    setHistoryEntries([]);
    toast.success("Recommendation history cleared.");
  };

  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 8000);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  useEffect(() => {
    const init = async () => {
      const userIdValue = await getAuthenticatedUserId();
      setUserId(userIdValue);
      await loadBooks(userIdValue);
      await loadFeedback(userIdValue);
      await loadHistory(userIdValue);
      await flushAllPendingSync();
    };
    void init();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setUserId(user?.id ?? null);
      void loadBooks(user?.id ?? null);
      void loadFeedback(user?.id ?? null);
      void loadHistory(user?.id ?? null);
      if (user?.id) void flushAllPendingSync();
    });
    return () => { listener.subscription.unsubscribe(); };
  }, []);

  const fetchTbrRecommendations = async () => {
    if (!userId) { toast.error("Sign in to get TBR recommendations."); return; }
    setLoadingRecommendations(true);
    setStatusMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("recommend-from-library", {
        body: { n: 5 },
      });
      if (error || !data) {
        let reason = "TBR recommendation service unavailable.";
        if (error?.message?.includes("401")) reason = "Session expired. Please sign in again.";
        else if (error?.message?.includes("429")) reason = "Too many requests. Try again in a moment.";
        setStatusMessage(reason);
        setLoadingRecommendations(false);
        return;
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setStatusMessage(data.warnings[0]);
      }
      const mapped = (data.recommendations || []).map((r: any) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        genre: r.genre || "General",
        tags: r.tags || [],
        summary: (r.reasons || []).join(". "),
        source: r.source || "claude",
        reasons: r.reasons || [],
        why_new: "From your TBR list",
      }));
      setRecommendations(mapped);
      await loadHistory(userId);
    } catch (e) {
      console.error("[ShelfGuide] TBR recommendation error:", e);
      setStatusMessage("Failed to get TBR recommendations.");
    }
    setLoadingRecommendations(false);
  };

  const fetchRecommendations = async () => {
    setLoadingRecommendations(true);
    setStatusMessage(null);
    if (userId) {
      const tastePayload = tasteSummary.hasRatings
        ? {
            topRatedGenres: tasteSummary.topRatedGenres.map((g) => g.key),
            topRatedAuthors: tasteSummary.topRatedAuthors.map((a) => a.key),
            recentFinished: tasteSummary.recentFinished.map((b) => ({
              title: b.title,
              author: b.author,
              rating: b.rating,
            })),
            avoidGenres: tasteSummary.avoidGenres.map((g) => g.key),
            avoidAuthors: tasteSummary.avoidAuthors.map((a) => a.key),
          }
        : {
            statusDist: tasteSummary.statusDist,
            fallbackGenres: tasteSummary.fallbackGenres.map((g) => g.key),
          };
      const { data, error } = await supabase.functions.invoke("reading-copilot", {
        body: { prompt, tags: promptTags, surprise, limit: 4, taste: tastePayload },
      });
      if (error || !data) {
        // Classify the error for a helpful message
        let reason = "Service temporarily unavailable. Showing curated picks.";
        if (!navigator.onLine) {
          reason = "No internet connection. Showing curated picks.";
        } else if (error?.message?.includes("401") || error?.message?.includes("403")) {
          reason = "Session expired. Please sign in again.";
        } else if (error?.message?.includes("429")) {
          reason = "Too many requests. Try again in a moment.";
        }
        if (import.meta.env.DEV) console.warn("[ShelfGuide] Copilot edge function error:", error);
        setStatusMessage(reason);
        setRecommendations(scoreFallback(FALLBACK_CATALOG, books, feedbackWeights, promptTags, surprise));
        setLoadingRecommendations(false);
        return;
      }
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        // Never show internal warnings to user; show graceful fallback note
        const w = data.warnings[0] || "";
        const isInternal = /no ai|heuristic|matched candidates|anthropic|key missing/i.test(w);
        setStatusMessage(isInternal ? "Using curated picks while we tune the AI." : w);
      }
      setRecommendations((data.recommendations || []) as Recommendation[]);
      await loadHistory(userId);
      setLoadingRecommendations(false);
      return;
    }
    setStatusMessage("Sign in for AI-powered recommendations. Showing curated picks.");
    setRecommendations(scoreFallback(FALLBACK_CATALOG, books, feedbackWeights, promptTags, surprise));
    setHistoryEntries([]);
    setLoadingRecommendations(false);
  };

  const [rejectingBookId, setRejectingBookId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const REJECT_REASONS = [
    "Not my genre",
    "Too long / too heavy",
    "Already read / not interested",
    "Doesn't match my prompt",
  ];

  const handleDecision = async (book: Recommendation, decision: "accepted" | "rejected", reason?: string, note?: string) => {
    const entry: FeedbackEntry = {
      book_id: book.id, title: book.title, author: book.author, genre: book.genre, tags: book.tags, decision,
      reason: reason || null, note: note || null, created_at: new Date().toISOString(),
    };
    if (userId) {
      if (!entry.title || !entry.decision) { setCloudNotice("Feedback missing required fields; not queued."); return; }
      const { error } = await db.from("copilot_feedback").insert([{ ...entry, user_id: userId }]);
      if (error) {
        await recordSyncError({ error, operation: "insert", table: "copilot_feedback", userId });
        const next = [entry, ...feedbackEntries].slice(0, 50);
        setFeedbackEntries(next); saveLocalFeedback(next);
        enqueueFeedbackSync(userId, entry);
        setCloudNotice("Will sync when online.");
        return;
      }
      const next = [entry, ...feedbackEntries].slice(0, 50);
      setFeedbackEntries(next);
      toast.success(decision === "accepted" ? "Thanks! We'll find more like this." : "Got it — we'll steer away from picks like this.");
      setRejectingBookId(null); setRejectReason(""); setRejectNote("");
      return;
    }
    const next = [entry, ...feedbackEntries].slice(0, 50);
    setFeedbackEntries(next); saveLocalFeedback(next);
    toast.success(decision === "accepted" ? "Thanks! We'll find more like this." : "Got it — we'll steer away from picks like this.");
    setRejectingBookId(null); setRejectReason(""); setRejectNote("");
  };

  const handleAddToLibrary = async (book: Recommendation) => {
    const exists = books.some((e) => normalize(e.title) === normalize(book.title) && normalize(e.author) === normalize(book.author));
    if (exists) { toast.error("This book is already in your library."); return; }
    const newBook = { title: book.title, author: book.author, genre: book.genre, series_name: null, is_first_in_series: false, status: "want_to_read" };
    if (userId) {
      const { error } = await upsertBooksToCloud(userId, [newBook]);
      if (error) {
        const syncError = await recordSyncError({ error, operation: "upsert", table: "books", userId });
        toast.error(`Could not add to cloud library: ${syncError.userMessage || syncError.message}. Queued for retry.`);
        const nextBooks = [newBook, ...books]; setBooks(nextBooks); setLocalBooks(nextBooks);
        enqueueLibrarySync(userId, [newBook], "copilot_add_to_library");
        setCloudNotice("Library change queued for cloud sync.");
        return;
      }
      await loadBooks(userId);
      toast.success("Added to your cloud library.");
      return;
    }
    const nextBooks = [newBook, ...books]; setBooks(nextBooks); setLocalBooks(nextBooks);
    toast.success("Added to your library.");
  };

  const handleAddHistoryToLibrary = async (entry: HistoryEntry) => {
    const rec: Recommendation = { id: entry.id, title: entry.title, author: entry.author || "Unknown", genre: entry.genre || "General", tags: entry.tags || [], summary: entry.summary || "", source: entry.source || "History", reasons: entry.reasons || [], why_new: entry.why_new || "" };
    await handleAddToLibrary(rec);
  };

  const resetFeedback = () => {
    // UI-only reset: clear local state but keep data in Supabase for analytics
    setFeedbackEntries([]);
    saveLocalFeedback([]);
    toast.success("Feedback reset. Your history is preserved for analytics.");
  };

  const stats = {
    accepted: feedbackEntries.filter((e) => e.decision === "accepted").length,
    rejected: feedbackEntries.filter((e) => e.decision === "rejected").length,
  };

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">ShelfGuide Copilot</h1>
        <p className="text-muted-foreground mt-2 font-body">Personalized recommendations with clear reasoning and human control.</p>
      </div>
      {cloudNotice && (
        <div className="mb-4 rounded-lg border border-border/60 bg-card/60 px-4 py-2 text-xs text-muted-foreground">{cloudNotice}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl border border-border/60 bg-card/70 p-6">
          <div className="flex items-center gap-3 mb-4">
            <MessageSquare className="h-5 w-5 text-primary" />
            <h2 className="font-display text-2xl font-bold">Signal Console</h2>
          </div>
          <p className="text-sm text-muted-foreground font-body mb-6">Share your mood or constraints. The copilot combines this with your library and feedback to propose a short list.</p>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">What are you in the mood for?</label>
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Examples: cozy mystery, epic fantasy, or a fast sci-fi adventure." className="min-h-[90px]" />
            </div>
            <div className="flex flex-wrap gap-2">
              {MOOD_TAGS.map((tag) => {
                const active = promptTags.includes(tag.id);
                return (
                  <Button key={tag.id} type="button" size="sm" variant={active ? "default" : "outline"}
                    onClick={() => setSelectedTags((prev) => prev.includes(tag.id) ? prev.filter((i) => i !== tag.id) : [...prev, tag.id])}>
                    {tag.label}
                  </Button>
                );
              })}
            </div>
            <div className="grid gap-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground"><span>Diversity control</span><span>{surprise}% surprise</span></div>
              <Slider value={[surprise]} min={0} max={100} step={5} onValueChange={(v) => setSurprise(v[0] ?? 35)} />
              <p className="text-xs text-muted-foreground">Slide right for more unexpected picks.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={fetchRecommendations} disabled={loadingRecommendations}><Sparkles className="w-4 h-4 mr-2" />{loadingRecommendations ? "Thinking..." : "Generate picks"}</Button>
               <Button variant="secondary" onClick={fetchTbrRecommendations} disabled={loadingRecommendations || !userId}><BookOpen className="w-4 h-4 mr-2" />{loadingRecommendations ? "Thinking..." : "Recommend from My TBR"}</Button>
               <Button variant="outline" onClick={resetFeedback}><RefreshCcw className="w-4 h-4 mr-2" />Reset feedback</Button>
            </div>
          </div>
          <div className="mt-8 grid gap-4">
            <Card className="border-border/60 bg-background/70"><CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground font-body"><BookOpen className="h-4 w-4" />Library signals</div>
              <p className="mt-2 text-sm font-body">{loadingLibrary ? "Loading your library signals..." : `Books tracked: ${books.length}`}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {tasteSummary.hasRatings ? (
                  tasteSummary.topRatedGenres.length > 0 ? (
                    tasteSummary.topRatedGenres.map((g) => (
                      <Badge key={`rated-genre-${g.key}`} variant="secondary">{g.key.replace(/_/g, " ")}</Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">Rate a few books to build a taste profile.</span>
                  )
                ) : (
                  profile.topGenres.length > 0 ? (
                    profile.topGenres.map((g) => <Badge key={g.key} variant="secondary">{g.key.replace(/_/g, " ")}</Badge>)
                  ) : (
                    <span className="text-xs text-muted-foreground">Add books to improve recommendations.</span>
                  )
                )}
              </div>
              {tasteSummary.hasRatings && tasteSummary.topRatedAuthors.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tasteSummary.topRatedAuthors.map((a) => (
                    <Badge key={`rated-author-${a.key}`} variant="outline">{a.key}</Badge>
                  ))}
                </div>
              )}
              {!tasteSummary.hasRatings && profile.topAuthors.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.topAuthors.map((a) => <Badge key={a.key} variant="outline">{a.key}</Badge>)}
                </div>
              )}
              {tasteSummary.hasRatings && tasteSummary.recentFinished.length > 0 && (
                <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  <div className="text-[10px] uppercase tracking-[0.2em]">Recent finishes</div>
                  {tasteSummary.recentFinished.map((entry) => (
                    <div key={`${entry.title}-${entry.author}`} className="flex justify-between">
                      <span className="truncate">{entry.title}</span>
                      <span>{entry.rating ? `${entry.rating}/5` : "unrated"}</span>
                    </div>
                  ))}
                </div>
              )}
              {tasteSummary.hasRatings && (tasteSummary.avoidGenres.length > 0 || tasteSummary.avoidAuthors.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tasteSummary.avoidGenres.map((g) => (
                    <Badge key={`avoid-genre-${g.key}`} variant="destructive">{g.key.replace(/_/g, " ")}</Badge>
                  ))}
                  {tasteSummary.avoidAuthors.map((a) => (
                    <Badge key={`avoid-author-${a.key}`} variant="destructive">{a.key}</Badge>
                  ))}
                </div>
              )}
              {!tasteSummary.hasRatings && Object.keys(tasteSummary.statusDist).length > 0 && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Status mix: {Object.entries(tasteSummary.statusDist).map(([key, value]) => `${key} ${value}`).join(" | ")}
                </div>
              )}
            </CardContent></Card>
            <Card className="border-border/60 bg-background/70"><CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground font-body"><ThumbsUp className="h-4 w-4" />Feedback signals</div>
              <p className="mt-2 text-sm font-body">Accepted: {stats.accepted} | Rejected: {stats.rejected}</p>
              <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                {feedbackEntries.length === 0 ? <span>No feedback yet. Accept or reject a pick to teach the copilot.</span> :
                  feedbackEntries.slice(0, 4).map((e) => <div key={`${e.title}-${e.created_at}`} className="flex justify-between"><span>{e.title}</span><span className={e.decision === "accepted" ? "text-emerald-600" : "text-rose-600"}>{e.decision}</span></div>)}
              </div>
            </CardContent></Card>
          </div>
        </section>

        <section className="grid gap-4">
          <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /><h2 className="font-display text-2xl font-bold">Recommendations</h2></div>
          {statusMessage && (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-4 text-sm text-muted-foreground flex items-center justify-between gap-3">
              <span>{statusMessage}</span>
              <Button size="sm" variant="outline" onClick={fetchRecommendations} disabled={loadingRecommendations}>Retry</Button>
            </div>
          )}
          {recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground font-body py-4">Generate picks to see personalized recommendations.</p>
          ) : (
            recommendations.map((book) => (
              <Card key={book.id} className="border-border/60 bg-card/80"><CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">{book.genre}</div>
                  <div className="flex flex-wrap gap-2">{book.tags.slice(0, 3).map((tag) => <Badge key={`${book.id}-${tag}`} variant="secondary">{tag}</Badge>)}</div>
                </div>
                <h3 className="font-display text-2xl font-bold mt-3">{book.title}</h3>
                <p className="text-sm text-muted-foreground font-body mt-1">{book.author}</p>
                {book.reasons.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm text-muted-foreground font-body">
                    {book.reasons.slice(0, 2).map((r) => <li key={`${book.id}-${r}`}>• {r}</li>)}
                  </ul>
                )}
                {book.why_new && <p className="mt-2 text-sm italic text-muted-foreground/80 font-body">{book.why_new}</p>}
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button size="sm" onClick={() => handleDecision(book, "accepted")}><ThumbsUp className="w-4 h-4 mr-2" />Good pick</Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectingBookId(rejectingBookId === book.id ? null : book.id)}>
                    <ThumbsDown className="w-4 h-4 mr-2" />Not for me <ChevronDown className="w-3 h-3 ml-1" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleAddToLibrary(book)}>Add to library</Button>
                </div>
                {rejectingBookId === book.id && (
                  <div className="mt-3 rounded-lg border border-border/60 bg-background/80 p-3 grid gap-2">
                    <p className="text-xs text-muted-foreground font-body">Why didn't this fit?</p>
                    <div className="flex flex-wrap gap-2">
                      {REJECT_REASONS.map((r) => (
                        <Button key={r} size="sm" variant={rejectReason === r ? "default" : "outline"} className="text-xs h-7"
                          onClick={() => setRejectReason(rejectReason === r ? "" : r)}>
                          {r}
                        </Button>
                      ))}
                    </div>
                    <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} placeholder="Any other thoughts? (optional)" className="min-h-[50px] text-sm" />
                    <div className="flex justify-end">
                      <Button size="sm" onClick={() => handleDecision(book, "rejected", rejectReason, rejectNote)}>Submit feedback</Button>
                    </div>
                  </div>
                )}
              </CardContent></Card>
            ))
          )}

          <Card className="border-border/60 bg-card/80"><CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">Recently Recommended</div>
                <h3 className="font-display text-xl font-bold mt-1">History</h3>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => loadHistory(userId)}>Refresh</Button>
                {confirmClear ? (
                  <><Button size="sm" variant="destructive" onClick={clearHistory}>Confirm clear</Button><Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button></>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>Clear</Button>
                )}
              </div>
            </div>
            <div className="max-h-[420px] md:max-h-[480px] overflow-y-auto">
              {!userId ? <p className="text-sm text-muted-foreground">Sign in to keep a recommendation history.</p> :
               loadingHistory ? <p className="text-sm text-muted-foreground">Loading history...</p> :
               historyEntries.length === 0 ? <p className="text-sm text-muted-foreground">No recommendations yet. Generate picks to populate your history.</p> :
               <div className="grid gap-3">
                 {historyEntries.map((entry) => (
                   <div key={entry.id} className="rounded-lg border border-border/50 bg-background/70 p-3 transition hover:border-primary/40 hover:bg-background" role="button" tabIndex={0}
                     onClick={() => setSelectedHistory(entry)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSelectedHistory(entry); }}>
                     <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{entry.genre || "General"}</span><span>{new Date(entry.created_at).toLocaleDateString()}</span></div>
                     <div className="mt-1 font-semibold">{entry.title}</div>
                     <div className="text-sm text-muted-foreground">{entry.author}</div>
                     {entry.reasons?.length > 0 && <div className="mt-2 text-xs text-muted-foreground">{entry.reasons[0]}</div>}
                     {entry.source && <div className="mt-1 text-[11px] text-muted-foreground/80">Source: {entry.source}</div>}
                   </div>
                 ))}
               </div>
              }
            </div>
          </CardContent></Card>
        </section>
      </div>

      <Drawer open={!!selectedHistory} onOpenChange={(open) => !open && setSelectedHistory(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{selectedHistory?.title}</DrawerTitle>
            <p className="text-sm text-muted-foreground">{selectedHistory?.author || "Unknown author"}</p>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-3">
            {selectedHistory?.summary && <p className="text-sm text-muted-foreground">{selectedHistory.summary}</p>}
            {selectedHistory?.reasons?.length ? (
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body mb-2">Why it fit</div>
                <ul className="space-y-1 text-sm text-muted-foreground font-body">{selectedHistory.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            ) : null}
            {selectedHistory?.why_new && <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-muted-foreground"><span className="font-semibold text-foreground">Why this is new for you:</span> {selectedHistory.why_new}</div>}
            <div className="flex flex-wrap gap-2">{(selectedHistory?.tags || []).slice(0, 4).map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>
          </div>
          <DrawerFooter>
            <Button onClick={() => selectedHistory && handleAddHistoryToLibrary(selectedHistory)}>Add to library</Button>
            <Button variant="outline" onClick={() => setSelectedHistory(null)}>Close</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </main>
  );
};

export default Copilot;
