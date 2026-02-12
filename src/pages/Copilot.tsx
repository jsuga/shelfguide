import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
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
  retryAsync,
  upsertBooksToCloud,
} from "@/lib/cloudSync";

type LibraryBook = {
  id?: string;
  title: string;
  author: string;
  genre: string;
  series_name: string | null;
  is_first_in_series: boolean;
  status: string;
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
  finished: 3,
  reading: 2,
  paused: 1.5,
  want_to_read: 1,
  tbr: 1,
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
  {
    id: "fallback-1",
    title: "The Name of the Wind",
    author: "Patrick Rothfuss",
    genre: "Fantasy",
    tags: ["epic", "magic", "thoughtful"],
    summary: "A lyrical origin story with music, myth, and a slow-burn mystery.",
    source: "Local catalog",
    reasons: [],
    why_new: "",
  },
  {
    id: "fallback-2",
    title: "Project Hail Mary",
    author: "Andy Weir",
    genre: "Science Fiction",
    tags: ["space", "fast"],
    summary: "A lone scientist fights to save humanity with science and humor.",
    source: "Local catalog",
    reasons: [],
    why_new: "",
  },
  {
    id: "fallback-3",
    title: "Gone Girl",
    author: "Gillian Flynn",
    genre: "Thriller",
    tags: ["fast", "mystery"],
    summary: "A dark, twisty look at marriage and media narratives.",
    source: "Local catalog",
    reasons: [],
    why_new: "",
  },
  {
    id: "fallback-4",
    title: "Pride and Prejudice",
    author: "Jane Austen",
    genre: "Romance",
    tags: ["romance", "thoughtful"],
    summary: "Wit, society, and slow-burn sparks in a timeless classic.",
    source: "Local catalog",
    reasons: [],
    why_new: "",
  },
  {
    id: "fallback-5",
    title: "The Thursday Murder Club",
    author: "Richard Osman",
    genre: "Mystery",
    tags: ["cozy", "mystery"],
    summary: "Retirees in a quiet village solve crimes with charm and wit.",
    source: "Local catalog",
    reasons: [],
    why_new: "",
  },
];

const normalize = (value: string) => value.trim().toLowerCase();

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

const loadLocalFeedback = (): FeedbackEntry[] => {
  const stored = localStorage.getItem(FEEDBACK_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as FeedbackEntry[];
  } catch {
    return [];
  }
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

  books.forEach((book) => {
    const weight = STATUS_WEIGHT[book.status] ?? 1;
    if (book.genre) {
      const key = normalize(book.genre);
      genreCounts[key] = (genreCounts[key] ?? 0) + weight;
    }
    if (book.author) {
      const key = normalize(book.author);
      authorCounts[key] = (authorCounts[key] ?? 0) + weight;
    }
  });

  const sortTop = (map: Record<string, number>, limit = 3) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([key, value]) => ({ key, value }));

  return {
    topGenres: sortTop(genreCounts),
    topAuthors: sortTop(authorCounts),
  };
};

const computeFeedbackWeights = (entries: FeedbackEntry[]): FeedbackWeights => {
  const weights: FeedbackWeights = { genres: {}, authors: {}, tags: {} };
  entries.forEach((entry) => {
    const delta = entry.decision === "accepted" ? 2 : -1;
    if (entry.genre) {
      const key = normalize(entry.genre);
      weights.genres[key] = (weights.genres[key] ?? 0) + delta;
    }
    if (entry.author) {
      const key = normalize(entry.author);
      weights.authors[key] = (weights.authors[key] ?? 0) + delta;
    }
    entry.tags.forEach((tag) => {
      weights.tags[tag] = (weights.tags[tag] ?? 0) + delta;
    });
  });
  return weights;
};

const scoreFallback = (
  catalog: Recommendation[],
  books: LibraryBook[],
  feedback: FeedbackWeights,
  promptTags: string[],
  surprise: number
) => {
  const profile = buildProfile(books);
  const excluded = new Set(books.map((book) => normalize(book.title)));
  const surpriseBoost = Math.max(0, Math.min(100, surprise)) / 100;

  return catalog
    .filter((book) => !excluded.has(normalize(book.title)))
    .map((book) => {
      const genreKey = normalize(book.genre);
      const authorKey = normalize(book.author);
      const genreWeight = profile.topGenres.find((entry) => entry.key === genreKey)?.value ?? 0;
      const authorWeight = profile.topAuthors.find((entry) => entry.key === authorKey)?.value ?? 0;
      const feedbackBoost =
        (feedback.genres[genreKey] ?? 0) + (feedback.authors[authorKey] ?? 0);
      const moodBoost = book.tags.filter((tag) => promptTags.includes(tag)).length * 1.5;
      const diversityPenalty = profile.topGenres.some((entry) => entry.key === genreKey)
        ? (1 - surpriseBoost) * 1.5
        : 0;
      const score =
        genreWeight * 0.7 +
        authorWeight * 1.2 +
        feedbackBoost * 0.6 +
        moodBoost +
        Math.random() * 0.2 -
        diversityPenalty;
      return {
        book,
        score,
        reasons: [
          "A steady fallback pick based on your library.",
          "Matches the mood signals you provided.",
        ],
        why_new: "A balanced option outside your current shelf.",
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => ({
      ...entry.book,
      reasons: entry.reasons,
      why_new: entry.why_new,
    }));
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
  const feedbackWeights = useMemo(
    () => computeFeedbackWeights(feedbackEntries),
    [feedbackEntries]
  );

  const loadBooks = async (userIdValue: string | null) => {
    if (!userIdValue) {
      setBooks(getLocalBooks());
      return;
    }
    setLoadingLibrary(true);
    const { data, error } = await retryAsync(
      () =>
        supabase
          .from("books")
          .select("*")
          .eq("user_id", userIdValue)
          .order("created_at", { ascending: false }),
      1,
      350
    );
    setLoadingLibrary(false);

    if (error) {
      setCloudNotice("Cloud sync unavailable. Using local data.");
      setBooks(getLocalBooks());
      return;
    }
    setCloudNotice(null);

    const cloudBooks = (data || []) as LibraryBook[];
    setBooks(cloudBooks);

    const localBooks = getLocalBooks();
    if (cloudBooks.length === 0 && localBooks.length > 0 && userIdValue) {
      const { error: insertError } = await supabase
        .from("books")
        .insert(localBooks.map((book) => ({ ...book, user_id: userIdValue })));
      if (!insertError) {
        setLocalBooks([]);
        const { data: refreshed } = await supabase
          .from("books")
          .select("*")
          .eq("user_id", userIdValue)
          .order("created_at", { ascending: false });
        setBooks((refreshed || []) as LibraryBook[]);
        toast.success("Migrated your local library to the cloud.");
      }
    }
  };

  const loadFeedback = async (userIdValue: string | null) => {
    if (!userIdValue) {
      setFeedbackEntries(loadLocalFeedback());
      return;
    }
    const { data, error } = await retryAsync(
      () =>
        supabase
          .from("copilot_feedback")
          .select("*")
          .eq("user_id", userIdValue)
          .order("created_at", { ascending: false })
          .limit(50),
      1,
      350
    );
    if (error) {
      setCloudNotice("Feedback sync paused. Using local cache.");
      setFeedbackEntries(loadLocalFeedback());
      return;
    }
    setFeedbackEntries((data || []) as FeedbackEntry[]);
  };

  const loadHistory = async (userIdValue: string | null) => {
    if (!userIdValue) {
      setHistoryEntries([]);
      return;
    }
    setLoadingHistory(true);
    const { data, error } = await retryAsync(
      () =>
        supabase
          .from("copilot_recommendations")
          .select("id,title,author,genre,source,reasons,summary,tags,why_new,created_at")
          .eq("user_id", userIdValue)
          .order("created_at", { ascending: false })
          .limit(8),
      1,
      350
    );
    setLoadingHistory(false);
    if (error) {
      setCloudNotice("Recommendation history unavailable right now.");
      return;
    }
    setHistoryEntries((data || []) as HistoryEntry[]);
  };

  const clearHistory = async () => {
    if (!userId) {
      setHistoryEntries([]);
      return;
    }
    const { error } = await supabase
      .from("copilot_recommendations")
      .delete()
      .eq("user_id", userId);
    if (error) {
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
      if (user?.id) {
        void flushAllPendingSync();
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  const fetchRecommendations = async () => {
    setLoadingRecommendations(true);
    setStatusMessage(null);

    if (userId) {
      const { data, error } = await supabase.functions.invoke("reading-copilot", {
        body: {
          prompt,
          tags: promptTags,
          surprise,
          limit: 4,
        },
      });

      if (error || !data) {
        setStatusMessage("Copilot is offline. Showing fallback recommendations.");
        const fallback = scoreFallback(
          FALLBACK_CATALOG,
          books,
          feedbackWeights,
          promptTags,
          surprise
        );
        setRecommendations(fallback);
        setLoadingRecommendations(false);
        return;
      }

      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        setStatusMessage(data.warnings[0]);
      }

      setRecommendations((data.recommendations || []) as Recommendation[]);
      await loadHistory(userId);
      setLoadingRecommendations(false);
      return;
    }

    setStatusMessage("Sign in for the full AI copilot. Showing fallback picks.");
    const fallback = scoreFallback(
      FALLBACK_CATALOG,
      books,
      feedbackWeights,
      promptTags,
      surprise
    );
    setRecommendations(fallback);
    setHistoryEntries([]);
    setLoadingRecommendations(false);
  };

  const handleDecision = async (book: Recommendation, decision: "accepted" | "rejected") => {
    const entry: FeedbackEntry = {
      book_id: book.id,
      title: book.title,
      author: book.author,
      genre: book.genre,
      tags: book.tags,
      decision,
      created_at: new Date().toISOString(),
    };

    if (userId) {
      const { error } = await supabase
        .from("copilot_feedback")
        .insert([{ ...entry, user_id: userId }]);
      if (error) {
        toast.error(`Could not save feedback: ${error.message}. Queued for retry.`);
        const next = [entry, ...feedbackEntries].slice(0, 50);
        setFeedbackEntries(next);
        saveLocalFeedback(next);
        enqueueFeedbackSync(entry);
        setCloudNotice("Feedback queued for cloud sync.");
        return;
      }
      const next = [entry, ...feedbackEntries].slice(0, 50);
      setFeedbackEntries(next);
      toast.success(decision === "accepted" ? "Recommendation accepted." : "Recommendation rejected.");
      return;
    }

    const next = [entry, ...feedbackEntries].slice(0, 50);
    setFeedbackEntries(next);
    saveLocalFeedback(next);
    toast.success(decision === "accepted" ? "Recommendation accepted." : "Recommendation rejected.");
  };

  const handleAddToLibrary = async (book: Recommendation) => {
    const exists = books.some(
      (entry) =>
        normalize(entry.title) === normalize(book.title) &&
        normalize(entry.author) === normalize(book.author)
    );
    if (exists) {
      toast.error("This book is already in your library.");
      return;
    }

    const newBook = {
      title: book.title,
      author: book.author,
      genre: book.genre,
      series_name: null,
      is_first_in_series: false,
      status: "want_to_read",
    };

    if (userId) {
      const { error } = await upsertBooksToCloud(userId, [newBook]);
      if (error) {
        toast.error(`Could not add to cloud library: ${error.message}. Queued for retry.`);
        const nextBooks = [newBook, ...books];
        setBooks(nextBooks);
        setLocalBooks(nextBooks);
        enqueueLibrarySync([newBook], "copilot_add_to_library");
        setCloudNotice("Library change queued for cloud sync.");
        return;
      }
      await loadBooks(userId);
      toast.success("Added to your cloud library.");
      return;
    }

    const nextBooks = [newBook, ...books];
    setBooks(nextBooks);
    setLocalBooks(nextBooks);
    toast.success("Added to your library.");
  };

  const handleAddHistoryToLibrary = async (entry: HistoryEntry) => {
    const rec: Recommendation = {
      id: entry.id,
      title: entry.title,
      author: entry.author || "Unknown",
      genre: entry.genre || "General",
      tags: entry.tags || [],
      summary: entry.summary || "",
      source: entry.source || "History",
      reasons: entry.reasons || [],
      why_new: entry.why_new || "",
    };
    await handleAddToLibrary(rec);
  };

  const resetFeedback = async () => {
    if (userId) {
      const { error } = await supabase
        .from("copilot_feedback")
        .delete()
        .eq("user_id", userId);
      if (error) {
        toast.error("Could not clear feedback.");
        return;
      }
    }
    setFeedbackEntries([]);
    saveLocalFeedback([]);
    toast.success("Feedback cleared.");
  };

  const stats = {
    accepted: feedbackEntries.filter((entry) => entry.decision === "accepted").length,
    rejected: feedbackEntries.filter((entry) => entry.decision === "rejected").length,
  };

  return (
    <main className="container mx-auto px-4 pt-24 pb-16">
      <div className="mb-8">
        <h1 className="font-display text-4xl font-bold">ShelfGuide Copilot</h1>
        <p className="text-muted-foreground mt-2 font-body">
          Personalized recommendations with clear reasoning and human control.
        </p>
      </div>
      {cloudNotice && (
        <div className="mb-4 rounded-lg border border-border/60 bg-card/60 px-4 py-2 text-xs text-muted-foreground">
          {cloudNotice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-xl border border-border/60 bg-card/70 p-6">
          <div className="flex items-center gap-3 mb-4">
            <MessageSquare className="h-5 w-5 text-primary" />
            <h2 className="font-display text-2xl font-bold">Signal Console</h2>
          </div>
          <p className="text-sm text-muted-foreground font-body mb-6">
            Share your mood or constraints. The copilot combines this with your library and
            feedback to propose a short list.
          </p>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">What are you in the mood for?</label>
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Examples: cozy mystery, epic fantasy, or a fast sci-fi adventure."
                className="min-h-[90px]"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {MOOD_TAGS.map((tag) => {
                const active = promptTags.includes(tag.id);
                return (
                  <Button
                    key={tag.id}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() =>
                      setSelectedTags((prev) =>
                        prev.includes(tag.id)
                          ? prev.filter((item) => item !== tag.id)
                          : [...prev, tag.id]
                      )
                    }
                  >
                    {tag.label}
                  </Button>
                );
              })}
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Diversity control</span>
                <span>{surprise}% surprise</span>
              </div>
              <Slider
                value={[surprise]}
                min={0}
                max={100}
                step={5}
                onValueChange={(value) => setSurprise(value[0] ?? 35)}
              />
              <p className="text-xs text-muted-foreground">
                Slide right for more unexpected picks.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button onClick={fetchRecommendations} disabled={loadingRecommendations}>
                <Sparkles className="w-4 h-4 mr-2" />
                {loadingRecommendations ? "Thinking..." : "Generate picks"}
              </Button>
              <Button variant="outline" onClick={resetFeedback}>
                <RefreshCcw className="w-4 h-4 mr-2" />
                Reset feedback
              </Button>
            </div>
          </div>

          <div className="mt-8 grid gap-4">
            <Card className="border-border/60 bg-background/70">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
                  <BookOpen className="h-4 w-4" />
                  Library signals
                </div>
                <p className="mt-2 text-sm font-body">
                  {loadingLibrary ? "Loading your library signals..." : `Books tracked: ${books.length}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.topGenres.length > 0 ? (
                    profile.topGenres.map((genre) => (
                      <Badge key={genre.key} variant="secondary">
                        {genre.key.replace(/_/g, " ")}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Add books to improve recommendations.
                    </span>
                  )}
                </div>
                {profile.topAuthors.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {profile.topAuthors.map((author) => (
                      <Badge key={author.key} variant="outline">
                        {author.key}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-background/70">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
                  <ThumbsUp className="h-4 w-4" />
                  Feedback signals
                </div>
                <p className="mt-2 text-sm font-body">
                  Accepted: {stats.accepted} | Rejected: {stats.rejected}
                </p>
                <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                  {feedbackEntries.length === 0 ? (
                    <span>No feedback yet. Accept or reject a pick to teach the copilot.</span>
                  ) : (
                    feedbackEntries.slice(0, 4).map((entry) => (
                      <div key={`${entry.title}-${entry.created_at}`} className="flex justify-between">
                        <span>{entry.title}</span>
                        <span className={entry.decision === "accepted" ? "text-emerald-600" : "text-rose-600"}>
                          {entry.decision}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="font-display text-2xl font-bold">Recommendations</h2>
          </div>

          {statusMessage && (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-4 text-sm text-muted-foreground">
              {statusMessage}
            </div>
          )}

          {recommendations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-8 text-center">
              <h3 className="font-display text-xl font-bold mb-2">Ready when you are</h3>
              <p className="text-sm text-muted-foreground font-body mb-4">
                Generate picks to see personalized recommendations.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={fetchRecommendations} disabled={loadingRecommendations}>
                  Generate picks
                </Button>
                <Button asChild variant="outline">
                  <Link to="/library">Add to my library</Link>
                </Button>
              </div>
            </div>
          ) : (
            recommendations.map((book) => (
              <Card key={book.id} className="border-border/60 bg-card/80">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
                      {book.genre}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {book.tags.slice(0, 3).map((tag) => (
                        <Badge key={`${book.id}-${tag}`} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <h3 className="font-display text-2xl font-bold mt-3">{book.title}</h3>
                  <p className="text-sm text-muted-foreground font-body mt-1">{book.author}</p>
                  <p className="text-sm text-muted-foreground font-body mt-3">{book.summary}</p>

                  <div className="mt-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body mb-2">
                      Why it fits
                    </div>
                    <ul className="space-y-1 text-sm text-muted-foreground font-body">
                      {book.reasons.map((reason) => (
                        <li key={`${book.id}-${reason}`}>{reason}</li>
                      ))}
                    </ul>
                  </div>

                  {book.why_new && (
                    <div className="mt-4 rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">Why this is new for you:</span>{" "}
                      {book.why_new}
                    </div>
                  )}

                  <div className="mt-2 text-xs text-muted-foreground">
                    Source: {book.source}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <Button size="sm" onClick={() => handleDecision(book, "accepted")}>
                      <ThumbsUp className="w-4 h-4 mr-2" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDecision(book, "rejected")}
                    >
                      <ThumbsDown className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleAddToLibrary(book)}>
                      Add to library
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          <Card className="border-border/60 bg-card/80">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body">
                    Recently Recommended
                  </div>
                  <h3 className="font-display text-xl font-bold mt-1">History</h3>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => loadHistory(userId)}>
                    Refresh
                  </Button>
                  {confirmClear ? (
                    <>
                      <Button size="sm" variant="destructive" onClick={clearHistory}>
                        Confirm clear
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              {!userId ? (
                <p className="text-sm text-muted-foreground">
                  Sign in to keep a recommendation history.
                </p>
              ) : loadingHistory ? (
                <p className="text-sm text-muted-foreground">Loading history...</p>
              ) : historyEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recommendations yet. Generate picks to populate your history.
                </p>
              ) : (
                <div className="grid gap-3">
                  {historyEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-border/50 bg-background/70 p-3 transition hover:border-primary/40 hover:bg-background"
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedHistory(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          setSelectedHistory(entry);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{entry.genre || "General"}</span>
                        <span>{new Date(entry.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="mt-1 font-semibold">{entry.title}</div>
                      <div className="text-sm text-muted-foreground">{entry.author}</div>
                      {entry.reasons?.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {entry.reasons[0]}
                        </div>
                      )}
                      {entry.source && (
                        <div className="mt-1 text-[11px] text-muted-foreground/80">
                          Source: {entry.source}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <Drawer open={!!selectedHistory} onOpenChange={(open) => !open && setSelectedHistory(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {selectedHistory?.title}
            </DrawerTitle>
            <p className="text-sm text-muted-foreground">
              {selectedHistory?.author || "Unknown author"}
            </p>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-3">
            {selectedHistory?.summary && (
              <p className="text-sm text-muted-foreground">{selectedHistory.summary}</p>
            )}
            {selectedHistory?.reasons?.length ? (
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-body mb-2">
                  Why it fit
                </div>
                <ul className="space-y-1 text-sm text-muted-foreground font-body">
                  {selectedHistory.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {selectedHistory?.why_new && (
              <div className="rounded-lg border border-border/60 bg-background/70 p-3 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Why this is new for you:</span>{" "}
                {selectedHistory.why_new}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {(selectedHistory?.tags || []).slice(0, 4).map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
          <DrawerFooter>
            <Button
              onClick={() => selectedHistory && handleAddHistoryToLibrary(selectedHistory)}
            >
              Add to library
            </Button>
            <Button variant="outline" onClick={() => setSelectedHistory(null)}>
              Close
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </main>
  );
};

export default Copilot;
