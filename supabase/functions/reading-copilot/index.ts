import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type LibraryBook = {
  title: string;
  author: string;
  genre: string;
  series_name: string | null;
  status: string;
};

type Preferences = {
  preferred_genres: string[];
  avoided_genres: string[];
  preferred_pace: string | null;
  preferred_formats: string[];
  notes: string | null;
};

type Feedback = {
  book_id: string | null;
  title: string;
  author: string | null;
  genre: string | null;
  tags: string[];
  decision: "accepted" | "rejected";
};

type Candidate = {
  id: string;
  title: string;
  author: string;
  genre: string;
  tags: string[];
  summary: string;
  source: string;
};

type Recommendation = Candidate & {
  reasons: string[];
  why_new: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-requested-with",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const normalize = (value: string) => value.trim().toLowerCase();

const compact = (value: string | null | undefined) =>
  value ? value.trim() : "";

const unique = (values: string[]) =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const getString = (value: unknown) => (typeof value === "string" ? value : "");

const getStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    null
  );
};

const checkRateLimit = async (params: {
  key: string;
  user_id: string | null;
  ip: string | null;
  limit: number;
  windowMs: number;
  client: any;
}) => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - params.windowMs);
  const { data, error } = await params.client
    .from("copilot_rate_limits")
    .select("*")
    .eq("key", params.key)
    .maybeSingle();

  if (error) {
    return { allowed: true, retryAfter: 0 };
  }

  if (!data) {
    await (params.client as any).from("copilot_rate_limits").insert({
      key: params.key,
      user_id: params.user_id,
      ip: params.ip,
      window_start: now.toISOString(),
      count: 1,
      updated_at: now.toISOString(),
    });
    return { allowed: true, retryAfter: 0 };
  }

  const lastStart = new Date((data as any).window_start);
  if (lastStart < windowStart) {
    await (params.client as any)
      .from("copilot_rate_limits")
      .update({ count: 1, window_start: now.toISOString(), updated_at: now.toISOString() })
      .eq("key", params.key);
    return { allowed: true, retryAfter: 0 };
  }

  if ((data as any).count >= params.limit) {
    const retryAfter = Math.max(
      0,
      Math.ceil((lastStart.getTime() + params.windowMs - now.getTime()) / 1000)
    );
    return { allowed: false, retryAfter };
  }

  await (params.client as any)
    .from("copilot_rate_limits")
    .update({ count: (data as any).count + 1, updated_at: now.toISOString() })
    .eq("key", params.key);
  return { allowed: true, retryAfter: 0 };
};

const buildProfile = (books: LibraryBook[]) => {
  const genreCounts: Record<string, number> = {};
  const authorCounts: Record<string, number> = {};

  const statusWeight: Record<string, number> = {
    finished: 3,
    reading: 2,
    paused: 1.5,
    want_to_read: 1,
    tbr: 1,
  };

  books.forEach((book) => {
    const weight = statusWeight[book.status] ?? 1;
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

const fetchGoogleBooks = async (query: string, limit = 18) => {
  if (!query) return [];
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(limit));
  url.searchParams.set("printType", "books");
  url.searchParams.set("langRestrict", "en");
  const key = Deno.env.get("GOOGLE_BOOKS_API_KEY");
  if (key) url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const payload = await res.json();
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items
    .map((item: any) => {
      const info = asRecord(asRecord(item).volumeInfo);
      const title = compact(getString(info.title));
      const authors = getStringArray(info.authors);
      const author = authors.length ? compact(String(authors[0])) : "";
      if (!title || !author) return null;
      const categories = getStringArray(info.categories);
      return {
        id: getString(asRecord(item).id) || `${title}-${author}`,
        title,
        author,
        genre: compact(categories[0]) || "General",
        tags: unique(
          categories
            .flatMap((entry) => entry.split("/"))
            .map((entry) => normalize(entry))
        ),
        summary: compact(getString(info.description)) || "No description available.",
        source: "Google Books",
      } as Candidate;
    })
    .filter(Boolean) as Candidate[];
};

const fetchOpenLibrary = async (query: string, limit = 18) => {
  if (!query) return [];
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const payload = await res.json();
  const docs = Array.isArray(payload.docs) ? payload.docs : [];
  return docs
    .map((doc: any) => {
      const record = asRecord(doc);
      const title = compact(getString(record.title));
      const authorNames = getStringArray(record.author_name);
      const author = authorNames.length ? compact(String(authorNames[0])) : "";
      if (!title || !author) return null;
      const subjects = getStringArray(record.subject).slice(0, 6);
      return {
        id: getString(record.key) || `${title}-${author}`,
        title,
        author,
        genre: compact(subjects[0]) || "General",
        tags: unique(subjects.map((entry) => normalize(entry))),
        summary: "Open Library result - see listing for full description.",
        source: "Open Library",
      } as Candidate;
    })
    .filter(Boolean) as Candidate[];
};

const extractJson = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

const buildFallback = (candidates: Candidate[], reasons: string[]): Recommendation[] => {
  return candidates.slice(0, 4).map((candidate) => ({
    ...candidate,
    reasons: reasons.slice(0, 2),
    why_new: "A fresh pick outside your current shelf.",
  }));
};

const persistHistory = async (
  client: any,
  userId: string,
  recommendations: Recommendation[]
) => {
  if (!recommendations.length) return;
  const payload = recommendations.map((rec) => ({
    user_id: userId,
    book_id: rec.id,
    title: rec.title,
    author: rec.author,
    genre: rec.genre,
    tags: rec.tags || [],
    summary: rec.summary,
    source: rec.source,
    reasons: rec.reasons || [],
    why_new: rec.why_new,
  }));
  await (client as any).from("copilot_recommendations").insert(payload);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: "Supabase environment not configured." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serviceClient = serviceKey
    ? createClient(supabaseUrl, serviceKey)
    : null;

  const {
    prompt = "",
    tags = [],
    surprise = 35,
    limit: reqLimit = 4,
  } = await req.json().catch(() => ({}));

  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  const ip = getClientIp(req);
  if (!user && !ip) {
    return json({ error: "Unauthorized" }, 401);
  }

  const rateLimitClient = user ? supabase : serviceClient;
  if (!rateLimitClient) {
    return json({ error: "Rate limit unavailable." }, 503);
  }

  const userLimit = Number(Deno.env.get("COPILOT_USER_LIMIT")) || 20;
  const ipLimit = Number(Deno.env.get("COPILOT_IP_LIMIT")) || 8;
  const windowMs =
    Number(Deno.env.get("COPILOT_RPS_WINDOW_MS")) || 10 * 60 * 1000;
  const rlLimit = user ? userLimit : ipLimit;
  const key = user ? `user:${user.id}` : `ip:${ip}`;
  const rateResult = await checkRateLimit({
    key,
    user_id: user?.id ?? null,
    ip,
    limit: rlLimit,
    windowMs,
    client: rateLimitClient as any,
  });
  if (!rateResult.allowed) {
    return json(
      {
        error: "Rate limit exceeded. Please try again later.",
        retry_after: rateResult.retryAfter,
      },
      429
    );
  }

  if (!user) {
    return json(
      {
        error: "Sign in required for personalized recommendations.",
      },
      401
    );
  }

  const [booksRes, prefsRes, feedbackRes] = await Promise.all([
    supabase.from("books").select("*").eq("user_id", user.id),
    supabase
      .from("copilot_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("copilot_feedback")
      .select("book_id,title,author,genre,tags,decision")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const books = (booksRes.data || []) as LibraryBook[];
  const preferences = (prefsRes.data || {
    preferred_genres: [],
    avoided_genres: [],
    preferred_formats: [],
    preferred_pace: null,
    notes: null,
  }) as Preferences;
  const feedback = (feedbackRes.data || []) as Feedback[];

  const profile = buildProfile(books);
  const topGenres = profile.topGenres.map((entry) => entry.key);

  const queryParts = [
    compact(prompt),
    ...preferences.preferred_genres.slice(0, 3),
    ...topGenres.slice(0, 2),
  ].filter(Boolean);
  const query = unique(queryParts).join(" ");

  const [googleResults, openLibraryResults] = await Promise.all([
    fetchGoogleBooks(query, 18),
    fetchOpenLibrary(query, 18),
  ]);

  const libraryTitles = new Set(books.map((book) => normalize(book.title)));
  const rejectedTitles = new Set(
    feedback.filter((entry) => entry.decision === "rejected").map((entry) => normalize(entry.title))
  );
  const avoidedGenres = new Set(
    (preferences.avoided_genres || []).map((genre) => normalize(genre))
  );

  const candidateMap = new Map<string, Candidate>();
  [...googleResults, ...openLibraryResults].forEach((candidate) => {
    const key = `${normalize(candidate.title)}-${normalize(candidate.author)}`;
    if (candidateMap.has(key)) return;
    if (libraryTitles.has(normalize(candidate.title))) return;
    if (rejectedTitles.has(normalize(candidate.title))) return;
    if (avoidedGenres.has(normalize(candidate.genre))) return;
    candidateMap.set(key, candidate);
  });

  const candidates = Array.from(candidateMap.values()).slice(0, 12);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514";
  const warnings: string[] = [];

  if (!anthropicKey) {
    warnings.push("Anthropic key missing - using heuristic picks.");
    const fallback = buildFallback(candidates, [
        "Based on your library and prompt.",
        "Fits a popular reader-friendly theme.",
      ]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback,
      profile,
      warnings,
      llm_used: false,
    });
  }

  const accepted = feedback.filter((entry) => entry.decision === "accepted").slice(0, 4);
  const rejected = feedback.filter((entry) => entry.decision === "rejected").slice(0, 4);

  const system = [
    "You are a ShelfGuide copilot that recommends books.",
    "Use the candidates list only; do not invent books.",
    "Return JSON only, matching the schema exactly.",
    "Use the surprise value to balance familiar vs. diverse picks.",
  ].join(" ");

  const userPrompt = {
    prompt: compact(prompt),
    surprise,
    diversity_rule:
      surprise >= 70
        ? "Include at least one recommendation outside the top genres."
        : surprise <= 30
        ? "Prefer recommendations aligned with top genres."
        : "Balance familiar and fresh picks.",
    preferences,
    profile,
    accepted,
    rejected,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      author: candidate.author,
      genre: candidate.genre,
      tags: candidate.tags.slice(0, 6),
      summary: candidate.summary.slice(0, 240),
      source: candidate.source,
    })),
    output_schema: {
      recommendations: [
        {
          id: "string",
          reasons: ["string"],
          why_new: "string",
        },
      ],
    },
  };

  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 800,
      temperature: 0.7,
      system,
      messages: [{ role: "user", content: JSON.stringify(userPrompt) }],
    }),
  });

  if (!anthropicResponse.ok) {
    warnings.push("Claude response failed - using heuristic picks.");
    const fallback = buildFallback(candidates, [
        "Based on your library and prompt.",
        "Uses a fallback ranking when AI is unavailable.",
      ]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback,
      profile,
      warnings,
      llm_used: false,
    });
  }

  const anthropicPayload = await anthropicResponse.json();
  const content = Array.isArray(anthropicPayload.content)
    ? anthropicPayload.content
    : [];
  const textBlock = content
    .map((part: any) => (asRecord(part).text ? String(asRecord(part).text) : ""))
    .join("\n");
  const parsed = extractJson(textBlock);
  if (!parsed || !Array.isArray(parsed.recommendations)) {
    warnings.push("Claude response could not be parsed - using heuristic picks.");
    const fallback = buildFallback(candidates, [
        "Based on your library and prompt.",
        "AI response was incomplete, so we used a fallback.",
      ]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback,
      profile,
      warnings,
      llm_used: false,
    });
  }

  const recs = parsed.recommendations
    .map((rec: any) => {
      const recRecord = asRecord(rec);
      const match = candidates.find((candidate) => candidate.id === recRecord.id);
      if (!match) return null;
      return {
        ...match,
        reasons: Array.isArray(recRecord.reasons)
          ? recRecord.reasons.map((entry) => String(entry)).slice(0, 3)
          : [],
        why_new: typeof recRecord.why_new === "string" ? recRecord.why_new : "",
      } as Recommendation;
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(6, Number(reqLimit) || 4))) as Recommendation[];

  if (recs.length === 0) {
    warnings.push("No Claude recommendations found - using heuristic picks.");
    const fallback = buildFallback(candidates, [
        "Based on your library and prompt.",
        "AI response did not include matching candidates.",
      ]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback,
      profile,
      warnings,
      llm_used: false,
    });
  }

  await persistHistory(supabase, user.id, recs);
  return json({
    recommendations: recs,
    profile,
    warnings,
    llm_used: true,
    model: anthropicModel,
  });
});
