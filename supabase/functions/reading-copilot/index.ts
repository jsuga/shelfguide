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
  atmosphere?: string | null;
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
    "authorization, x-client-info, apikey, content-type, x-requested-with, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const normalize = (value: string) => value.trim().toLowerCase();
const compact = (value: string | null | undefined) => value ? value.trim() : "";
const unique = (values: string[]) =>
  Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const getString = (value: unknown) => (typeof value === "string" ? value : "");
const getStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((e: unknown) => typeof e === "string") : [];

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || null;
};

const checkRateLimit = async (params: {
  key: string;
  user_id: string | null;
  ip: string | null;
  limit: number;
  windowMs: number;
  client: ReturnType<typeof createClient>;
}) => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - params.windowMs);
  const { data, error } = await (params.client as any)
    .from("copilot_rate_limits")
    .select("*")
    .eq("key", params.key)
    .maybeSingle();

  if (error) return { allowed: true, retryAfter: 0 };

  if (!data) {
    await (params.client as any).from("copilot_rate_limits").insert({
      key: params.key, user_id: params.user_id, ip: params.ip,
      window_start: now.toISOString(), count: 1, updated_at: now.toISOString(),
    });
    return { allowed: true, retryAfter: 0 };
  }

  const lastStart = new Date((data as any).window_start);
  if (lastStart < windowStart) {
    await (params.client as any).from("copilot_rate_limits")
      .update({ count: 1, window_start: now.toISOString(), updated_at: now.toISOString() })
      .eq("key", params.key);
    return { allowed: true, retryAfter: 0 };
  }

  if ((data as any).count >= params.limit) {
    const retryAfter = Math.max(0, Math.ceil((lastStart.getTime() + params.windowMs - now.getTime()) / 1000));
    return { allowed: false, retryAfter };
  }

  await (params.client as any).from("copilot_rate_limits")
    .update({ count: (data as any).count + 1, updated_at: now.toISOString() })
    .eq("key", params.key);
  return { allowed: true, retryAfter: 0 };
};

const buildProfile = (books: LibraryBook[]) => {
  const genreCounts: Record<string, number> = {};
  const authorCounts: Record<string, number> = {};
  const statusWeight: Record<string, number> = { finished: 3, reading: 2, paused: 1.5, want_to_read: 1, tbr: 1 };

  books.forEach((book) => {
    const weight = statusWeight[book.status] ?? 1;
    if (book.genre) { const k = normalize(book.genre); genreCounts[k] = (genreCounts[k] ?? 0) + weight; }
    if (book.author) { const k = normalize(book.author); authorCounts[k] = (authorCounts[k] ?? 0) + weight; }
  });

  const sortTop = (map: Record<string, number>, limit = 3) =>
    Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, value]) => ({ key, value }));

  return { topGenres: sortTop(genreCounts), topAuthors: sortTop(authorCounts) };
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
  return items.map((item: any) => {
    const info = asRecord(asRecord(item).volumeInfo);
    const title = compact(getString(info.title));
    const authors = getStringArray(info.authors);
    const author = authors.length ? compact(String(authors[0])) : "";
    if (!title || !author) return null;
    const categories = getStringArray(info.categories);
    return {
      id: getString(asRecord(item).id) || `${title}-${author}`,
      title, author,
      genre: compact(categories[0]) || "General",
      tags: unique(categories.flatMap((e: string) => e.split("/")).map((e: string) => normalize(e))),
      summary: compact(getString(info.description)) || "No description available.",
      source: "Google Books",
    } as Candidate;
  }).filter(Boolean) as Candidate[];
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
  return docs.map((doc: any) => {
    const record = asRecord(doc);
    const title = compact(getString(record.title));
    const authorNames = getStringArray(record.author_name);
    const author = authorNames.length ? compact(String(authorNames[0])) : "";
    if (!title || !author) return null;
    const subjects = getStringArray(record.subject).slice(0, 6);
    return {
      id: getString(record.key) || `${title}-${author}`,
      title, author,
      genre: compact(subjects[0]) || "General",
      tags: unique(subjects.map((e: string) => normalize(e))),
      summary: "Open Library result - see listing for full description.",
      source: "Open Library",
    } as Candidate;
  }).filter(Boolean) as Candidate[];
};

const extractJson = (text: string) => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
};

const buildFallback = (candidates: Candidate[], reasons: string[]): Recommendation[] =>
  candidates.slice(0, 4).map((c) => ({
    ...c, reasons: reasons.slice(0, 2), why_new: "A fresh pick that might surprise you.",
  }));

const persistHistory = async (
  client: ReturnType<typeof createClient>, userId: string, recommendations: Recommendation[]
) => {
  if (!recommendations.length) return;
  const payload = recommendations.map((rec) => ({
    user_id: userId, book_id: rec.id, title: rec.title, author: rec.author,
    genre: rec.genre, tags: rec.tags || [], summary: rec.summary, source: rec.source,
    reasons: rec.reasons || [], why_new: rec.why_new,
  }));
  await (client as any).from("copilot_recommendations").insert(payload);
};

/** Fetch with exponential backoff retry for 429/5xx errors */
const fetchWithRetry = async (
  url: string, init: RequestInit, maxRetries = 3
): Promise<Response> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      // Retry on 429 or 5xx
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => "");
        console.warn(`[reading-copilot] LLM attempt ${attempt + 1} failed: ${res.status} ${body}`);
        lastError = new Error(`HTTP ${res.status}: ${body}`);
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      // Non-retryable error
      return res;
    } catch (err) {
      console.warn(`[reading-copilot] LLM attempt ${attempt + 1} network error:`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error("LLM fetch failed after retries");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({} as any));
  const debugMode = Boolean((body as any).debug);

  if (debugMode) {
    const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    return json({
      ok: true, function: "reading-copilot",
      env_present: {
        SUPABASE_URL: Boolean(Deno.env.get("SUPABASE_URL")),
        SUPABASE_ANON_KEY: Boolean(Deno.env.get("SUPABASE_ANON_KEY")),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
        LOVABLE_API_KEY: Boolean(lovableKey),
        ANTHROPIC_API_KEY: Boolean(anthropicKey),
        GOOGLE_BOOKS_API_KEY: Boolean(Deno.env.get("GOOGLE_BOOKS_API_KEY")),
        LLM_ENABLED: Deno.env.get("LLM_ENABLED") ?? "true",
      },
      lovable_key_len: lovableKey.length,
      anthropic_key_len: anthropicKey.length,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseKey) return json({ error: "Backend not configured." }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing authorization header." }, 401);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
  if (claimsError || !claimsData?.user) return json({ error: "Invalid or expired token." }, 401);
  const user = claimsData.user;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const serviceClient = serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  const { prompt = "", tags = [], surprise = 35, limit: reqLimit = 4 } = body as any;

  const ip = getClientIp(req);
  const rateLimitClient = serviceClient || supabase;
  const userLimit = Number(Deno.env.get("COPILOT_USER_LIMIT")) || 200;
  const windowMs = Number(Deno.env.get("COPILOT_RPS_WINDOW_MS")) || 10 * 60 * 1000;

  const rateResult = await checkRateLimit({
    key: `user:${user.id}`, user_id: user.id, ip,
    limit: userLimit, windowMs, client: rateLimitClient,
  });
  if (!rateResult.allowed) {
    return json({ error: "Rate limit exceeded. Please try again later.", retry_after: rateResult.retryAfter }, 429);
  }

  const [booksRes, prefsRes, feedbackRes] = await Promise.all([
    (supabase as any).from("books").select("*").eq("user_id", user.id),
    (supabase as any).from("copilot_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    (supabase as any).from("copilot_feedback").select("book_id,title,author,genre,tags,decision")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
  ]);

  const books = (booksRes.data || []) as LibraryBook[];
  const preferences = (prefsRes.data || {
    preferred_genres: [], avoided_genres: [], preferred_formats: [],
    preferred_pace: null, notes: null, atmosphere: "cozy",
  }) as Preferences;
  const feedback = (feedbackRes.data || []) as Feedback[];

  const profile = buildProfile(books);
  const topGenres = profile.topGenres.map((e) => e.key);

  const queryParts = [compact(prompt), ...preferences.preferred_genres.slice(0, 3), ...topGenres.slice(0, 2)].filter(Boolean);
  const query = unique(queryParts).join(" ");

  const [googleResults, openLibraryResults] = await Promise.all([
    fetchGoogleBooks(query, 18), fetchOpenLibrary(query, 18),
  ]);

  const libraryTitles = new Set(books.map((b) => normalize(b.title)));
  const rejectedTitles = new Set(feedback.filter((e) => e.decision === "rejected").map((e) => normalize(e.title)));
  const avoidedGenres = new Set((preferences.avoided_genres || []).map((g: string) => normalize(g)));

  const candidateMap = new Map<string, Candidate>();
  [...googleResults, ...openLibraryResults].forEach((c) => {
    const mapKey = `${normalize(c.title)}-${normalize(c.author)}`;
    if (candidateMap.has(mapKey)) return;
    if (libraryTitles.has(normalize(c.title))) return;
    if (rejectedTitles.has(normalize(c.title))) return;
    if (avoidedGenres.has(normalize(c.genre))) return;
    candidateMap.set(mapKey, c);
  });

  const candidates = Array.from(candidateMap.values()).slice(0, 12);

  // --- LLM-first flow ---
  const llmEnabled = (Deno.env.get("LLM_ENABLED") ?? "true") !== "false";
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const warnings: string[] = [];

  if (!llmEnabled) {
    const fallback = buildFallback(candidates, ["Matches your library's vibe.", "A popular reader favorite."]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      warnings: ["LLM is disabled by configuration. Showing curated picks."],
    });
  }

  if (!lovableApiKey && !anthropicKey) {
    const fallback = buildFallback(candidates, ["Matches your library's vibe.", "A popular reader favorite."]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      warnings: [],
      error: { code: "MISSING_AI_KEY", message: "No AI API key configured. Please add LOVABLE_API_KEY or ANTHROPIC_API_KEY." },
    });
  }

  const accepted = feedback.filter((e) => e.decision === "accepted").slice(0, 4);
  const rejected = feedback.filter((e) => e.decision === "rejected").slice(0, 4);

  const systemPrompt = [
    "You are a ShelfGuide copilot that recommends books.",
    "Use the candidates list only; do not invent books.",
    "Return JSON only, matching the schema exactly.",
    "Use the surprise value to balance familiar vs. diverse picks.",
    "Each reason must be max 12 words. Give exactly 2 reasons per book.",
    "why_new must be a short personable sentence, max 18 words.",
    "Be concise, warm, and personable. No jargon.",
  ].join(" ");

  const userPrompt = {
    prompt: compact(prompt), surprise,
    diversity_rule: surprise >= 70 ? "Include at least one recommendation outside the top genres."
      : surprise <= 30 ? "Prefer recommendations aligned with top genres."
      : "Balance familiar and fresh picks.",
    preferences,
    atmosphere: preferences.atmosphere || (preferences as any).ui_theme || "cozy",
    profile, accepted, rejected,
    candidates: candidates.map((c) => ({
      id: c.id, title: c.title, author: c.author, genre: c.genre,
      tags: c.tags.slice(0, 6), summary: c.summary.slice(0, 240), source: c.source,
    })),
    output_schema: { recommendations: [{ id: "string", reasons: ["string"], why_new: "string" }] },
  };

  // Try Lovable AI Gateway first, then Anthropic — both with retry
  let llmResponse: Response | null = null;
  let modelUsed = "";
  let llmError: string | null = null;

  if (lovableApiKey) {
    const gatewayModel = "google/gemini-2.5-flash";
    try {
      llmResponse = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${lovableApiKey}` },
        body: JSON.stringify({
          model: gatewayModel, max_tokens: 800, temperature: 0.7,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(userPrompt) },
          ],
        }),
      }, 3);
      if (llmResponse.ok) {
        modelUsed = gatewayModel;
      } else {
        const errText = await llmResponse.text().catch(() => "");
        console.warn("[reading-copilot] Lovable Gateway final failure:", llmResponse.status, errText);
        llmError = `Lovable Gateway ${llmResponse.status}`;
        llmResponse = null;
      }
    } catch (err) {
      console.warn("[reading-copilot] Lovable Gateway error after retries:", err);
      llmError = String(err);
      llmResponse = null;
    }
  }

  if (!llmResponse && anthropicKey) {
    const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514";
    try {
      llmResponse = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: anthropicModel, max_tokens: 800, temperature: 0.7,
          system: systemPrompt,
          messages: [{ role: "user", content: JSON.stringify(userPrompt) }],
        }),
      }, 3);
      if (llmResponse.ok) {
        modelUsed = anthropicModel;
      } else {
        const errText = await llmResponse.text().catch(() => "");
        console.warn("[reading-copilot] Anthropic final failure:", llmResponse.status, errText);
        llmError = `Anthropic ${llmResponse.status}`;
        llmResponse = null;
      }
    } catch (err) {
      console.warn("[reading-copilot] Anthropic error after retries:", err);
      llmError = String(err);
      llmResponse = null;
    }
  }

  // If both LLM providers failed after retries
  if (!llmResponse) {
    const fallback = buildFallback(candidates, ["Matches your library's vibe.", "Hand-picked from search results."]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      warnings: ["AI service temporarily unavailable. Showing curated picks."],
      error: { code: "LLM_UNAVAILABLE", message: llmError || "All LLM providers failed after retries." },
    });
  }

  const llmPayload = await llmResponse.json();

  let textBlock = "";
  if (llmPayload.choices && Array.isArray(llmPayload.choices)) {
    textBlock = llmPayload.choices[0]?.message?.content || "";
  } else if (Array.isArray(llmPayload.content)) {
    textBlock = llmPayload.content.map((part: any) => (asRecord(part).text ? String(asRecord(part).text) : "")).join("\n");
  }

  const parsed = extractJson(textBlock);
  if (!parsed || !Array.isArray(parsed.recommendations)) {
    console.warn("[reading-copilot] Failed to parse LLM JSON, using fallback. Raw:", textBlock.slice(0, 300));
    const fallback = buildFallback(candidates, ["Matches your library's vibe.", "Hand-picked from search results."]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      warnings: ["AI response could not be parsed. Showing curated picks."],
      error: { code: "LLM_PARSE_ERROR", message: "Could not parse structured response from AI." },
    });
  }

  const recs = parsed.recommendations
    .map((rec: any) => {
      const r = asRecord(rec);
      const match = candidates.find((c) => c.id === r.id);
      if (!match) return null;
      return {
        ...match,
        reasons: Array.isArray(r.reasons) ? r.reasons.map((e: unknown) => String(e)).slice(0, 3) : [],
        why_new: typeof r.why_new === "string" ? r.why_new : "",
      } as Recommendation;
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Math.min(6, Number(reqLimit) || 4))) as Recommendation[];

  if (recs.length === 0) {
    console.warn("[reading-copilot] AI returned IDs that didn't match candidates. Falling back.");
    const fallback = buildFallback(candidates, ["Matches your library's vibe.", "Hand-picked from search results."]);
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      warnings: ["AI picks didn't match available books. Showing curated picks."],
      error: { code: "LLM_NO_MATCH", message: "AI candidate IDs did not match search results." },
    });
  }

  await persistHistory(supabase, user.id, recs);
  return json({
    recommendations: recs, llm_used: true, source: "llm",
    warnings, model: modelUsed,
  });
});
