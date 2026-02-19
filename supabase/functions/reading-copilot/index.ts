import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
const compact = (value: string | null | undefined) => (value ? value.trim() : "");
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

// ─── Rate limiting ───────────────────────────────────────────────────────────

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

// ─── Profile builder ─────────────────────────────────────────────────────────

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

// ─── Book search APIs ────────────────────────────────────────────────────────

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

// ─── JSON parsing (hardened for Claude output) ───────────────────────────────

const extractJson = (text: string): any => {
  // 1. Direct parse
  try { return JSON.parse(text.trim()); } catch { /* continue */ }

  // 2. Strip markdown fences
  const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(stripped); } catch { /* continue */ }

  // 3. Extract first { ... } substring
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch { /* continue */ }
  }

  // 4. Try extracting [ ... ] (array)
  const aStart = stripped.indexOf("[");
  const aEnd = stripped.lastIndexOf("]");
  if (aStart !== -1 && aEnd > aStart) {
    try {
      const arr = JSON.parse(stripped.slice(aStart, aEnd + 1));
      if (Array.isArray(arr)) return { recommendations: arr };
    } catch { /* continue */ }
  }

  return null;
};

// ─── Curated fallback builder ────────────────────────────────────────────────

const buildFallback = (candidates: Candidate[], reasons: string[]): Recommendation[] =>
  candidates.slice(0, 4).map((c) => ({
    ...c, reasons: reasons.slice(0, 2), why_new: "A fresh pick that might surprise you.",
  }));

const STATIC_CURATED: Recommendation[] = [
  { id: "curated-1", title: "The House in the Cerulean Sea", author: "TJ Klune", genre: "Fantasy", tags: ["cozy", "fantasy", "found family"], summary: "A heartwarming fantasy about finding family in unexpected places.", source: "Curated", reasons: ["Beloved cozy fantasy", "Uplifting and heartfelt"], why_new: "A warm hug of a book loved by readers worldwide." },
  { id: "curated-2", title: "Project Hail Mary", author: "Andy Weir", genre: "Science Fiction", tags: ["sci-fi", "adventure", "humor"], summary: "A lone astronaut must save Earth with science, wit, and an unlikely ally.", source: "Curated", reasons: ["Gripping sci-fi adventure", "Witty and clever"], why_new: "Science meets heart in this page-turner." },
  { id: "curated-3", title: "The Thursday Murder Club", author: "Richard Osman", genre: "Mystery", tags: ["cozy mystery", "humor", "british"], summary: "Four retirees meet weekly to investigate cold cases—until a real murder happens.", source: "Curated", reasons: ["Charming cozy mystery", "Laugh-out-loud funny"], why_new: "Proof that the best detectives are over seventy." },
  { id: "curated-4", title: "Circe", author: "Madeline Miller", genre: "Fantasy", tags: ["mythology", "literary fiction", "feminist"], summary: "The mythological sorceress Circe tells her own epic story of power and transformation.", source: "Curated", reasons: ["Stunning mythological retelling", "Powerful and lyrical"], why_new: "Ancient myth reimagined with breathtaking prose." },
];

// ─── Fetch curated from DB, fallback to static ──────────────────────────────

const fetchCuratedFromDb = async (
  client: ReturnType<typeof createClient>,
  userId: string,
  limit = 5
): Promise<Recommendation[]> => {
  try {
    // Get popular recommendations from other users (service role bypasses RLS)
    const { data } = await (client as any)
      .from("copilot_recommendations")
      .select("book_id,title,author,genre,tags,summary,source,reasons,why_new")
      .neq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (data && data.length > 0) {
      return data.map((r: any) => ({
        id: r.book_id || `curated-${r.title}`,
        title: r.title,
        author: r.author || "Unknown",
        genre: r.genre || "General",
        tags: r.tags || [],
        summary: r.summary || "",
        source: "Curated",
        reasons: r.reasons?.length ? r.reasons : ["Popular with readers"],
        why_new: r.why_new || "A hand-picked recommendation.",
      }));
    }
  } catch (e) {
    console.warn("[reading-copilot] Failed to fetch curated from DB:", e);
  }
  return [];
};

// ─── Persist history ─────────────────────────────────────────────────────────

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

// ─── Fetch with exponential backoff ──────────────────────────────────────────

const fetchWithRetry = async (
  url: string, init: RequestInit, maxRetries = 3
): Promise<Response> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => "");
        console.warn(`[reading-copilot] LLM attempt ${attempt + 1} failed: ${res.status} ${body}`);
        lastError = new Error(`HTTP ${res.status}: ${body}`);
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
      }
      return res;
    } catch (err) {
      console.warn(`[reading-copilot] LLM attempt ${attempt + 1} network error:`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  throw lastError || new Error("LLM fetch failed after retries");
};

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({} as any));
  const debugMode = Boolean((body as any).debug);

  // ── Debug probe ──
  if (debugMode && !(body as any).prompt) {
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
    const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    return json({
      ok: true, function: "reading-copilot",
      env_present: {
        SUPABASE_URL: Boolean(Deno.env.get("SUPABASE_URL")),
        SUPABASE_ANON_KEY: Boolean(Deno.env.get("SUPABASE_ANON_KEY")),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
        ANTHROPIC_API_KEY: Boolean(anthropicKey),
        LOVABLE_API_KEY: Boolean(lovableKey),
        GOOGLE_BOOKS_API_KEY: Boolean(Deno.env.get("GOOGLE_BOOKS_API_KEY")),
        LLM_ENABLED: Deno.env.get("LLM_ENABLED") ?? "true",
      },
      anthropic_key_len: anthropicKey.length,
      lovable_key_len: lovableKey.length,
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

  // ── Rate limiting ──
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

  // ── Fetch user data ──
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

  // ── Fetch candidates from search APIs ──
  const [googleResults, openLibraryResults] = await Promise.all([
    fetchGoogleBooks(query || "popular fiction bestseller", 18),
    fetchOpenLibrary(query || "popular fiction", 18),
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

  // ── Helper: get curated fallback (DB then static) ──
  const getCuratedFallback = async (): Promise<Recommendation[]> => {
    // First try from candidates
    if (candidates.length > 0) {
      return buildFallback(candidates, ["Matches your library's vibe.", "A popular reader favorite."]);
    }
    // Then try DB
    if (serviceClient) {
      const dbCurated = await fetchCuratedFromDb(serviceClient, user.id, 5);
      if (dbCurated.length > 0) return dbCurated;
    }
    // Static fallback
    return STATIC_CURATED.slice(0, 4);
  };

  // ── LLM flow ──
  const llmEnabled = (Deno.env.get("LLM_ENABLED") ?? "true") !== "false";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  const debugInfo: any = debugMode ? {
    provider_attempted: "none",
    model_attempted: null,
    raw_llm_text: null,
    parse_attempts: [] as string[],
    curated_count: 0,
    anthropic_status: null,
    candidate_count: candidates.length,
  } : null;

  if (!llmEnabled) {
    const fallback = await getCuratedFallback();
    if (debugInfo) debugInfo.curated_count = fallback.length;
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      provider: "curated", model: null,
      warnings: ["LLM is disabled by configuration. Showing curated picks."],
      ...(debugInfo ? { debug: debugInfo } : {}),
    });
  }

  if (!anthropicKey && !lovableApiKey) {
    const fallback = await getCuratedFallback();
    if (debugInfo) debugInfo.curated_count = fallback.length;
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      provider: "curated", model: null,
      warnings: [],
      ...(debugInfo ? { debug: { ...debugInfo, internal_error: "MISSING_ANTHROPIC_KEY" } } : {}),
    });
  }

  // ── Build prompts ──
  const accepted = feedback.filter((e) => e.decision === "accepted").slice(0, 4);
  const rejected = feedback.filter((e) => e.decision === "rejected").slice(0, 4);

  const systemPrompt = [
    "You are a ShelfGuide copilot that recommends books.",
    "You MUST select from the candidates list provided. Do not invent books.",
    "Return ONLY valid JSON. No markdown. No code fences. No commentary. No explanation.",
    "If the candidates list is empty or you cannot make recommendations, return: {\"recommendations\": []}",
    "Use the surprise value to balance familiar vs. diverse picks.",
    "Each reason must be max 12 words. Give exactly 2 reasons per book.",
    "why_new must be a short personable sentence, max 18 words.",
    "",
    "Required JSON schema:",
    "{\"recommendations\": [{\"id\": \"string\", \"reasons\": [\"string\", \"string\"], \"why_new\": \"string\"}]}",
    "",
    "Example valid response:",
    "{\"recommendations\": [{\"id\": \"abc123\", \"reasons\": [\"Perfect cozy read for winter\", \"Beloved by fantasy fans\"], \"why_new\": \"A fresh take that will surprise you.\"}]}",
  ].join("\n");

  const userPrompt = JSON.stringify({
    prompt: compact(prompt), surprise,
    diversity_rule: surprise >= 70 ? "Include at least one recommendation outside the top genres."
      : surprise <= 30 ? "Prefer recommendations aligned with top genres."
      : "Balance familiar and fresh picks.",
    preferences,
    atmosphere: preferences.atmosphere || "cozy",
    profile, accepted, rejected,
    candidates: candidates.map((c) => ({
      id: c.id, title: c.title, author: c.author, genre: c.genre,
      tags: c.tags.slice(0, 6), summary: c.summary.slice(0, 240), source: c.source,
    })),
  });

  // ── Try Anthropic first, then Lovable AI Gateway ──
  let llmResponse: Response | null = null;
  let modelUsed = "";
  let providerUsed = "curated";
  let llmError: string | null = null;

  if (anthropicKey) {
    const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-20250514";
    if (debugInfo) { debugInfo.provider_attempted = "anthropic"; debugInfo.model_attempted = anthropicModel; }
    try {
      llmResponse = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: anthropicModel, max_tokens: 800, temperature: 0.7,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
      }, 3);
      if (llmResponse.ok) {
        modelUsed = anthropicModel;
        providerUsed = "anthropic";
        if (debugInfo) debugInfo.anthropic_status = 200;
      } else {
        const status = llmResponse.status;
        const errText = await llmResponse.text().catch(() => "");
        console.warn("[reading-copilot] Anthropic final failure:", status, errText);
        if (debugInfo) debugInfo.anthropic_status = status;
        llmError = status === 429 ? "ANTHROPIC_RATE_LIMIT" : `ANTHROPIC_UPSTREAM_ERROR (${status})`;
        llmResponse = null;
      }
    } catch (err) {
      console.warn("[reading-copilot] Anthropic error after retries:", err);
      llmError = String(err);
      llmResponse = null;
    }
  }

  // Fallback to Lovable AI Gateway if Anthropic failed
  if (!llmResponse && lovableApiKey) {
    const gatewayModel = "google/gemini-2.5-flash";
    if (debugInfo) { debugInfo.provider_attempted = "lovable_gateway"; debugInfo.model_attempted = gatewayModel; }
    try {
      llmResponse = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${lovableApiKey}` },
        body: JSON.stringify({
          model: gatewayModel, max_tokens: 800, temperature: 0.7,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      }, 3);
      if (llmResponse.ok) {
        modelUsed = gatewayModel;
        providerUsed = "lovable_gateway";
      } else {
        const errText = await llmResponse.text().catch(() => "");
        console.warn("[reading-copilot] Lovable Gateway final failure:", llmResponse.status, errText);
        llmError = llmError || `Lovable Gateway ${llmResponse.status}`;
        llmResponse = null;
      }
    } catch (err) {
      console.warn("[reading-copilot] Lovable Gateway error after retries:", err);
      llmError = llmError || String(err);
      llmResponse = null;
    }
  }

  // ── Both providers failed ──
  if (!llmResponse) {
    const fallback = await getCuratedFallback();
    if (debugInfo) debugInfo.curated_count = fallback.length;
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      provider: "curated", model: null,
      warnings: [],
      ...(debugInfo ? { debug: { ...debugInfo, internal_error: llmError || "All LLM providers failed after retries." } } : {}),
    });
  }

  // ── Parse LLM response ──
  const llmPayload = await llmResponse.json();
  let textBlock = "";

  // Anthropic format: { content: [{ type: "text", text: "..." }] }
  if (Array.isArray(llmPayload.content)) {
    textBlock = llmPayload.content
      .map((part: any) => (asRecord(part).text ? String(asRecord(part).text) : ""))
      .join("\n");
  }
  // OpenAI-compatible format: { choices: [{ message: { content: "..." } }] }
  else if (llmPayload.choices && Array.isArray(llmPayload.choices)) {
    textBlock = llmPayload.choices[0]?.message?.content || "";
  }

  if (debugInfo) {
    debugInfo.raw_llm_text = textBlock.slice(0, 5000);
    debugInfo.parse_attempts = [];
  }

  const parsed = extractJson(textBlock);
  if (debugInfo) debugInfo.parse_attempts.push(parsed ? "extractJson: success" : "extractJson: failed");

  if (!parsed || !Array.isArray(parsed.recommendations)) {
    console.warn("[reading-copilot] Failed to parse LLM JSON. Raw:", textBlock.slice(0, 500));
    const fallback = await getCuratedFallback();
    if (debugInfo) debugInfo.curated_count = fallback.length;
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      provider: "curated", model: modelUsed,
      warnings: [],
      ...(debugInfo ? { debug: { ...debugInfo, internal_error: "LLM_PARSE_ERROR" } } : {}),
    });
  }

  // ── Map LLM picks to candidates ──
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
    const fallback = await getCuratedFallback();
    if (debugInfo) debugInfo.curated_count = fallback.length;
    await persistHistory(supabase, user.id, fallback);
    return json({
      recommendations: fallback, llm_used: false, source: "curated",
      provider: "curated", model: modelUsed,
      warnings: [],
      ...(debugInfo ? { debug: { ...debugInfo, internal_error: "LLM_NO_MATCH" } } : {}),
    });
  }

  await persistHistory(supabase, user.id, recs);
  return json({
    recommendations: recs, llm_used: true, source: "llm",
    provider: providerUsed, model: modelUsed,
    warnings: [],
    ...(debugInfo ? { debug: debugInfo } : {}),
  });
});
