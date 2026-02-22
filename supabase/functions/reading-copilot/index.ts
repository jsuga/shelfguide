import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ───────────────────────────────────────────────────────────────────

type LibraryBook = {
  id: string;
  title: string;
  author: string;
  genre: string | null;
  series_name: string | null;
  status: string | null;
  rating: number | null;
  page_count: number | null;
  description: string | null;
  tags?: string[];
  is_first_in_series?: boolean;
};

type Feedback = {
  book_id: string | null;
  title: string;
  author: string | null;
  genre: string | null;
  decision: "accepted" | "rejected";
};

type RotationContext = {
  ranked_ids: string[];
  cursor: number;
  cooldown_ids: string[];
  eligible_hash: string;
  updated_at: string;
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

type ClaudeLibraryPick = { book_id: string; why: string[] };
type ClaudePromptPick = { title: string; author: string; genre: string; why: string[] };

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

const normalize = (v: string) => v.trim().toLowerCase();
const compact = (v: string | null | undefined) => (v ? v.trim() : "");

// Map mood-tag IDs from the UI to canonical DB genre names
const MOOD_TAG_TO_GENRE: Record<string, string[]> = {
  romance: ["Romance"],
  mystery: ["Mystery"],
  space: ["Science Fiction", "Sci-Fi"],
  history: ["History", "Historical Fiction", "Biography"],
  magic: ["Fantasy"],
  epic: ["Fantasy", "Epic Fantasy"],
  cozy: ["Cozy Mystery", "Mystery", "Romance"],
  fast: [],            // pace modifier, not a genre
  thoughtful: [],      // mood modifier, not a genre
};

/** Resolve UI tags to actual DB genre names for strict filtering */
const resolveGenresFromTags = (tags: string[]): string[] => {
  const resolved = new Set<string>();
  for (const tag of tags) {
    const mapped = MOOD_TAG_TO_GENRE[tag.toLowerCase()];
    if (mapped && mapped.length > 0) {
      mapped.forEach(g => resolved.add(g));
    } else {
      // Treat as a literal genre name (capitalised)
      const cap = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
      resolved.add(cap);
      resolved.add(tag); // also keep raw for case-insensitive matching
    }
  }
  return [...resolved];
};

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || null;
};

const hashIds = (ids: string[]): string => {
  const sorted = [...ids].sort();
  let h = 0;
  for (const id of sorted) {
    for (let i = 0; i < id.length; i++) {
      h = ((h << 5) - h + id.charCodeAt(i)) | 0;
    }
  }
  return String(h >>> 0);
};

const extractJson = (text: string): any | null => {
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch { /* */ } }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch { /* */ } }
  return null;
};

// ─── Rate limiting ───────────────────────────────────────────────────────────

const checkRateLimit = async (params: {
  key: string; user_id: string | null; ip: string | null;
  limit: number; windowMs: number; client: any;
}) => {
  const now = new Date();
  const windowStart = new Date(now.getTime() - params.windowMs);
  const { data, error } = await params.client
    .from("copilot_rate_limits").select("*").eq("key", params.key).maybeSingle();
  if (error) return { allowed: true, retryAfter: 0 };
  if (!data) {
    await params.client.from("copilot_rate_limits").insert({
      key: params.key, user_id: params.user_id, ip: params.ip,
      window_start: now.toISOString(), count: 1, updated_at: now.toISOString(),
    });
    return { allowed: true, retryAfter: 0 };
  }
  const lastStart = new Date(data.window_start);
  if (lastStart < windowStart) {
    await params.client.from("copilot_rate_limits")
      .update({ count: 1, window_start: now.toISOString(), updated_at: now.toISOString() })
      .eq("key", params.key);
    return { allowed: true, retryAfter: 0 };
  }
  if (data.count >= params.limit) {
    const retryAfter = Math.max(0, Math.ceil((lastStart.getTime() + params.windowMs - now.getTime()) / 1000));
    return { allowed: false, retryAfter };
  }
  await params.client.from("copilot_rate_limits")
    .update({ count: data.count + 1, updated_at: now.toISOString() })
    .eq("key", params.key);
  return { allowed: true, retryAfter: 0 };
};

// ─── Fetch recent recommendation IDs from DB ────────────────────────────────

const fetchRecentRecommendedIds = async (
  client: any, userId: string, limit = 9,
): Promise<string[]> => {
  try {
    const { data } = await client
      .from("copilot_recommendations")
      .select("book_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data) return [];
    return data
      .map((r: any) => r.book_id)
      .filter((id: string | null) => id && !id.startsWith("prompt-"));
  } catch {
    return [];
  }
};

// ─── Quality Scoring (fallback) ──────────────────────────────────────────────

const scoreBook = (
  book: LibraryBook, authorCounts: Record<string, number>, genreCounts: Record<string, number>,
  rejectedTitles: Set<string>, selectedGenres: string[], moodKeywords: string[], cooldownSet: Set<string>,
): number => {
  let score = 50;
  const authorKey = normalize(book.author);
  score += Math.min((authorCounts[authorKey] ?? 0) * 3, 15);
  if (selectedGenres.length > 0 && book.genre) {
    if (selectedGenres.some(sg => normalize(sg) === normalize(book.genre!))) score += 10;
  }
  if (book.genre) score += Math.min((genreCounts[normalize(book.genre)] ?? 0) * 2, 10);
  if (moodKeywords.length > 0) {
    const text = `${book.title} ${book.genre || ""} ${book.description || ""} ${book.series_name || ""}`.toLowerCase();
    score += moodKeywords.filter(kw => text.includes(kw)).length * 5;
  }
  if (book.series_name) score += 5;
  const status = normalize(book.status || "tbr");
  if (status === "tbr" || status === "want_to_read") score += 8;
  else if (status === "reading") score += 3;
  if (status === "finished" || status === "read") score -= 30;
  if (rejectedTitles.has(normalize(book.title))) score -= 40;
  if (cooldownSet.has(book.id)) score -= 20;
  if (typeof book.rating === "number" && book.rating <= 2) score -= 25;
  if (moodKeywords.some(k => ["quick", "fast", "short"].includes(k)) && book.page_count && book.page_count < 300) score += 5;
  return score;
};

// ─── Fallback Why Builder ────────────────────────────────────────────────────

type WhyContext = {
  selectedGenres: string[]; moodText: string; moodKeywords: string[];
  authorCounts: Record<string, number>; allBooks: LibraryBook[];
};

const buildFallbackBullets = (book: LibraryBook, ctx: WhyContext, idx: number): string[] => {
  const bullets: string[] = [];
  const genre = book.genre || "";
  if (ctx.selectedGenres.length > 0 && genre) {
    const v = [`Matches your selected genre: ${genre}`, `Right in the ${genre} category you chose`, `A ${genre} pick matching your selection`];
    bullets.push(v[idx % v.length]);
  }
  if (ctx.moodText && ctx.moodKeywords.length > 0) {
    const searchable = `${book.title} ${genre} ${book.description || ""}`.toLowerCase();
    const matched = ctx.moodKeywords.filter(kw => searchable.includes(kw));
    if (matched.length > 0) {
      bullets.push(`Fits your '${ctx.moodText.slice(0, 30)}' mood — aligns with "${matched.slice(0, 2).join(", ")}"`);
    } else if (genre) {
      bullets.push(`You asked for '${ctx.moodText.slice(0, 25)}' — ${genre} titles tend to deliver that`);
    }
  }
  const authorKey = normalize(book.author);
  const authorFreq = ctx.authorCounts[authorKey] ?? 0;
  if (authorFreq >= 2) bullets.push(`You have ${authorFreq} books by ${book.author} in your library`);
  const status = normalize(book.status || "tbr");
  if (status === "tbr" || status === "want_to_read") {
    const v = ["Already on your TBR — a low-friction next read", "Sitting in your to-be-read pile, ready to go"];
    bullets.push(v[idx % v.length]);
  }
  if (typeof book.page_count === "number" && book.page_count > 0) {
    if (book.page_count < 250) bullets.push(`A quick read at ${book.page_count} pages`);
    else if (book.page_count > 500) bullets.push(`An immersive ${book.page_count}-page read`);
  }
  bullets.push(`Fresh pick to vary your reading${genre ? ` within ${genre}` : ""}`);
  return bullets;
};

const buildAllFallbackWhyBullets = (books: LibraryBook[], ctx: WhyContext): Map<string, string[]> => {
  const used = new Set<string>();
  const result = new Map<string, string[]>();
  for (let i = 0; i < books.length; i++) {
    const candidates = buildFallbackBullets(books[i], ctx, i);
    const chosen: string[] = [];
    for (const b of candidates) {
      if (chosen.length >= 3) break;
      const k = b.trim().toLowerCase();
      if (!used.has(k)) { chosen.push(b); used.add(k); }
    }
    if (chosen.length < 2) {
      const fb = "Hand-picked from your library based on your reading history";
      if (!used.has(fb.toLowerCase())) { chosen.push(fb); used.add(fb.toLowerCase()); }
    }
    result.set(books[i].id, chosen.slice(0, 3));
  }
  return result;
};

// ─── Claude API Call ─────────────────────────────────────────────────────────

const callClaude = async (
  systemPrompt: string, userMessage: string, requestId: string, retryCount = 0,
): Promise<{ content: string; success: boolean; provider: string }> => {
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    console.warn(`[reading-copilot] request_id=${requestId} ANTHROPIC_API_KEY not set, trying Lovable AI`);
    return callLovableAI(systemPrompt, userMessage, requestId);
  }

  try {
    console.log(`[reading-copilot] request_id=${requestId} claude_call_start retry=${retryCount}`);
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (response.status === 429 || response.status >= 500) {
      const body = await response.text().catch(() => "");
      console.error(`[reading-copilot] request_id=${requestId} claude_call_failure status=${response.status} body=${body.slice(0, 150)}`);
      if (retryCount < 2) {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(r => setTimeout(r, delay));
        return callClaude(systemPrompt, userMessage, requestId, retryCount + 1);
      }
      return callLovableAI(systemPrompt, userMessage, requestId);
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error(`[reading-copilot] request_id=${requestId} claude_call_failure status=${response.status} body=${errText.slice(0, 200)}`);
      return callLovableAI(systemPrompt, userMessage, requestId);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || "";
    console.log(`[reading-copilot] request_id=${requestId} claude_call_success len=${content.length} provider=anthropic`);
    return { content, success: true, provider: "anthropic" };
  } catch (e) {
    console.error(`[reading-copilot] request_id=${requestId} claude_call_failure exception:`, e);
    return callLovableAI(systemPrompt, userMessage, requestId);
  }
};

const callLovableAI = async (
  systemPrompt: string, userMessage: string, requestId: string,
): Promise<{ content: string; success: boolean; provider: string }> => {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.error(`[reading-copilot] request_id=${requestId} claude_call_failure no AI keys available`);
    return { content: "", success: false, provider: "none" };
  }
  try {
    console.log(`[reading-copilot] request_id=${requestId} claude_call_start provider=lovable_ai_fallback`);
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
        temperature: 0.8,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[reading-copilot] request_id=${requestId} claude_call_failure provider=lovable_ai status=${response.status} body=${body.slice(0, 150)}`);
      return { content: "", success: false, provider: "lovable_ai" };
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log(`[reading-copilot] request_id=${requestId} claude_call_success len=${content.length} provider=lovable_ai`);
    return { content, success: true, provider: "lovable_ai" };
  } catch (e) {
    console.error(`[reading-copilot] request_id=${requestId} claude_call_failure provider=lovable_ai exception:`, e);
    return { content: "", success: false, provider: "lovable_ai" };
  }
};

// ─── Claude prompt builders ──────────────────────────────────────────────────

const buildLibrarySystemPrompt = (
  selectedGenres: string[], moodText: string, excludeIds: string[], requestNonce: string,
) => {
  const genreRule = selectedGenres.length > 0
    ? `STRICT RULE: Every recommended book MUST have a genre matching one of: [${selectedGenres.join(", ")}]. No exceptions. Do NOT recommend books outside these genres.`
    : "";
  const moodRule = moodText
    ? `The user's mood/request: "${moodText}". Recommendations should strongly match this vibe and theme.`
    : "";
  const excludeRule = excludeIds.length > 0
    ? `EXCLUDE RULE: Do NOT choose these book_ids (recently recommended, must avoid): [${excludeIds.join(", ")}]. Pick DIFFERENT books.`
    : "";

  return `You are a book recommendation expert selecting from a user's personal library.
You will receive a list of candidate books with their metadata. Select exactly 3 books that best match the user's request.
Each request is unique (nonce: ${requestNonce}). Provide fresh, varied selections.

${genreRule}
${moodRule}
${excludeRule}

Return ONLY valid JSON with this exact schema:
{"recommendations":[{"book_id":"<uuid>","why":["bullet1","bullet2","bullet3"]}]}

Rules for "why" bullets:
- Exactly 3 bullets per book.
- Each bullet MUST reference specific aspects: the selected genre, the user's mood/request text, author affinity, series continuity, or reading status.
- Never use generic filler like "great read", "dive back in", "you'll love this", "highly recommended".
- Be specific: cite the book's genre, the user's stated mood, or concrete metadata.
- All bullets must be distinct within each book AND across all 3 recommendations. No duplicate or near-duplicate bullets.
- If genres were selected, the first bullet MUST explicitly state the genre match (e.g., "Matches your Fantasy selection").
- If mood text was provided, at least one bullet MUST reference the mood/theme specifically.

Return ONLY the JSON object. No markdown, no commentary, no explanation outside JSON.`;
};

const buildPromptOnlySystemPrompt = (selectedGenres: string[], moodText: string, requestNonce: string) => {
  const genreRule = selectedGenres.length > 0
    ? `STRICT RULE: Every recommended book MUST be in one of these genres: [${selectedGenres.join(", ")}]. No exceptions.`
    : "";
  const moodRule = moodText
    ? `The user's request: "${moodText}". All recommendations must closely match this theme and vibe.`
    : "";

  return `You are a book recommendation expert. The user has no personal library yet.
Recommend exactly 3 real, published books based on their request.
Each request is unique (nonce: ${requestNonce}). Provide fresh, varied selections different from common/obvious picks.

${genreRule}
${moodRule}

Return ONLY valid JSON with this exact schema:
{"recommendations":[{"title":"string","author":"string","genre":"string","why":["bullet1","bullet2","bullet3"]}]}

Rules for "why" bullets:
- Exactly 3 bullets per book.
- Each bullet must directly reference the user's request (genre, mood, theme, constraints).
- Never use generic filler. Be specific about why THIS book matches THEIR request.
- All bullets must be distinct within each book AND across the 3 books.
- If genres were selected, the first bullet must explicitly name the genre match.
- If mood/request text was provided, at least one bullet must reference it.

Return ONLY the JSON object. No markdown.`;
};

const buildCandidateList = (books: LibraryBook[]): string => {
  return books.map(b => {
    const parts = [`id:${b.id}`, `title:"${b.title}"`, `author:"${b.author}"`];
    if (b.genre) parts.push(`genre:"${b.genre}"`);
    if (b.series_name) parts.push(`series:"${b.series_name}"`);
    if (b.status) parts.push(`status:${b.status}`);
    if (b.page_count) parts.push(`pages:${b.page_count}`);
    if (b.description) parts.push(`desc:"${b.description.slice(0, 80)}"`);
    return parts.join(" | ");
  }).join("\n");
};

// ─── Validation ──────────────────────────────────────────────────────────────

const validateLibraryPicks = (
  picks: ClaudeLibraryPick[], candidateIds: Set<string>, selectedGenres: string[],
  candidateMap: Map<string, LibraryBook>, excludeIds: Set<string>, eligibleCount: number,
): { valid: ClaudeLibraryPick[]; errors: string[] } => {
  const errors: string[] = [];
  const seen = new Set<string>();
  const usedBullets = new Set<string>();
  const valid: ClaudeLibraryPick[] = [];
  const hasAlternatives = eligibleCount >= 6;

  for (const pick of picks) {
    if (!pick.book_id || !candidateIds.has(pick.book_id)) {
      errors.push(`Invalid book_id: ${pick.book_id}`);
      continue;
    }
    if (seen.has(pick.book_id)) { errors.push(`Duplicate: ${pick.book_id}`); continue; }

    // Strict exclude enforcement when alternatives exist
    if (excludeIds.has(pick.book_id) && hasAlternatives) {
      errors.push(`Excluded book_id used: ${pick.book_id}`);
      continue;
    }

    // Genre check
    if (selectedGenres.length > 0) {
      const book = candidateMap.get(pick.book_id);
      if (book && book.genre && !selectedGenres.some(g => normalize(g) === normalize(book.genre!))) {
        errors.push(`Genre mismatch for ${pick.book_id}: ${book.genre} not in [${selectedGenres.join(",")}]`);
        continue;
      }
    }

    if (!Array.isArray(pick.why) || pick.why.length < 2) {
      errors.push(`Insufficient why bullets for ${pick.book_id}`);
      continue;
    }

    const cleanWhy = pick.why.filter(b => {
      const k = b.trim().toLowerCase();
      if (usedBullets.has(k)) return false;
      usedBullets.add(k);
      return true;
    }).slice(0, 3);

    if (cleanWhy.length < 2) { errors.push(`Duplicate bullets for ${pick.book_id}`); continue; }

    seen.add(pick.book_id);
    valid.push({ ...pick, why: cleanWhy });
    if (valid.length >= 3) break;
  }

  return { valid, errors };
};

const validatePromptPicks = (
  picks: ClaudePromptPick[], selectedGenres: string[],
): { valid: ClaudePromptPick[]; errors: string[] } => {
  const errors: string[] = [];
  const seen = new Set<string>();
  const usedBullets = new Set<string>();
  const valid: ClaudePromptPick[] = [];

  for (const pick of picks) {
    if (!pick.title || !pick.author) { errors.push("Missing title/author"); continue; }
    const key = normalize(`${pick.title}::${pick.author}`);
    if (seen.has(key)) { errors.push(`Duplicate: ${pick.title}`); continue; }

    if (selectedGenres.length > 0 && pick.genre &&
        !selectedGenres.some(g => normalize(g) === normalize(pick.genre))) {
      errors.push(`Genre mismatch: ${pick.title} is ${pick.genre}`);
      continue;
    }

    if (!Array.isArray(pick.why) || pick.why.length < 2) {
      errors.push(`Insufficient why for ${pick.title}`);
      continue;
    }

    const cleanWhy = pick.why.filter(b => {
      const k = b.trim().toLowerCase();
      if (usedBullets.has(k)) return false;
      usedBullets.add(k);
      return true;
    }).slice(0, 3);

    if (cleanWhy.length < 2) { errors.push(`Duplicate bullets for ${pick.title}`); continue; }

    seen.add(key);
    valid.push({ ...pick, why: cleanWhy });
    if (valid.length >= 3) break;
  }

  return { valid, errors };
};

// ─── Match Score ─────────────────────────────────────────────────────────────

const computeMatchScore = (
  recs: Recommendation[], selectedGenres: string[], moodKeywords: string[],
): number => {
  if (recs.length === 0) return 0;
  let total = 0;
  for (const rec of recs) {
    let s = 30;
    if (selectedGenres.length > 0 && selectedGenres.some(g => normalize(g) === normalize(rec.genre))) s += 30;
    if (moodKeywords.length > 0) {
      const bulletText = rec.reasons.join(" ").toLowerCase();
      const matches = moodKeywords.filter(kw => bulletText.includes(kw)).length;
      s += Math.min(matches * 10, 30);
    }
    if (rec.reasons.length >= 3) s += 10;
    total += Math.min(s, 100);
  }
  return Math.round(total / recs.length);
};

// ─── Persist history ─────────────────────────────────────────────────────────

const persistHistory = async (
  client: any, userId: string, recs: Recommendation[], requestId: string,
  llmUsed: boolean, source: string,
): Promise<boolean> => {
  if (!recs.length) return true;
  const payload = recs.map((rec) => ({
    user_id: userId, book_id: rec.id, title: rec.title, author: rec.author,
    genre: rec.genre, tags: rec.tags || [], summary: rec.summary, source,
    reasons: rec.reasons || [], why_new: rec.why_new,
  }));
  try {
    const { error } = await client.from("copilot_recommendations").insert(payload);
    if (error) {
      console.error(`[reading-copilot] request_id=${requestId} db_write_error:`, error.message);
      return false;
    }
    console.log(`[reading-copilot] request_id=${requestId} db_write_success count=${recs.length} source=${source} llm_used=${llmUsed}`);
    return true;
  } catch (e) {
    console.error(`[reading-copilot] request_id=${requestId} db_write_error:`, e);
    return false;
  }
};

// ─── Main handler ────────────────────────────────────────────────────────────

const FIXED_N = 3;
const COPILOT_DEBUG = Deno.env.get("COPILOT_DEBUG") !== "false"; // default ON, set COPILOT_DEBUG=false to disable

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const requestId = crypto.randomUUID();
  const requestNonce = crypto.randomUUID().slice(0, 8); // per-request nonce to prevent stale/cached output
  const body = await req.json().catch(() => ({} as any));

  if (Boolean(body.debug) && !body.prompt && !body.tags) {
    return json({
      ok: true, function: "reading-copilot", request_id: requestId,
      env_present: {
        SUPABASE_URL: Boolean(Deno.env.get("SUPABASE_URL")),
        SUPABASE_ANON_KEY: Boolean(Deno.env.get("SUPABASE_ANON_KEY")),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
        ANTHROPIC_API_KEY: Boolean(Deno.env.get("ANTHROPIC_API_KEY")),
        LOVABLE_API_KEY: Boolean(Deno.env.get("LOVABLE_API_KEY")),
      },
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

  const promptText = compact(body.prompt || "");
  const tagsArr: string[] = Array.isArray(body.tags) ? body.tags : [];
  // Resolve mood-tag IDs to actual DB genre names for strict filtering
  const rawTags: string[] = tagsArr
    .filter((t: string) => typeof t === "string")
    .map((t: string) => t.trim())
    .filter(Boolean);
  const selectedGenres: string[] = resolveGenresFromTags(rawTags);

  const moodKeywords = promptText.toLowerCase().split(/[\s,]+/).filter((w: string) => w.length > 2);

  console.log(`[reading-copilot] START request_id=${requestId} nonce=${requestNonce} user_id=${user.id} genres=${JSON.stringify(selectedGenres)} mood="${promptText.slice(0, 50)}"`);

  // ── Rate limiting ──
  const ip = getClientIp(req);
  const rateLimitClient = serviceClient || supabase;
  const rateResult = await checkRateLimit({
    key: `user:${user.id}`, user_id: user.id, ip,
    limit: 200, windowMs: 10 * 60 * 1000, client: rateLimitClient,
  });
  if (!rateResult.allowed) {
    return json({ error: "Rate limit exceeded. Please try again later.", retry_after: rateResult.retryAfter }, 429);
  }

  // ── Fetch user's library + feedback + preferences + recent recommendations (parallel) ──
  const [booksRes, feedbackRes, prefsRes, recentRecIds] = await Promise.all([
    (supabase as any).from("books").select("id,title,author,genre,series_name,status,rating,page_count,description,is_first_in_series")
      .eq("user_id", user.id).limit(1000),
    (supabase as any).from("copilot_feedback").select("book_id,title,author,genre,decision")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    (supabase as any).from("copilot_preferences").select("rotation_state")
      .eq("user_id", user.id).maybeSingle(),
    fetchRecentRecommendedIds(supabase, user.id, 9),
  ]);

  const allBooks: LibraryBook[] = (booksRes.data || []) as LibraryBook[];
  const feedback: Feedback[] = (feedbackRes.data || []) as Feedback[];
  const rotationState: Record<string, RotationContext> =
    (prefsRes.data?.rotation_state as Record<string, RotationContext>) || {};

  // Merge DB recent recs with rotation cooldown for comprehensive exclude list
  const dbExcludeSet = new Set(recentRecIds);

  // ════════════════════════════════════════════════════════════════════════════
  // PATH A: No library — prompt-only Claude mode
  // ════════════════════════════════════════════════════════════════════════════

  if (allBooks.length === 0) {
    console.log(`[reading-copilot] request_id=${requestId} NO_LIBRARY mode`);

    if (!promptText && selectedGenres.length === 0) {
      return json({
        recommendations: [], mode: "no_library",
        warnings: ["Tell me what you're in the mood for! Try a genre, mood, or describe what you want to read."],
        ...(COPILOT_DEBUG ? { _debug: { request_id: requestId, claude_called: false, llm_used: false, source: "none", candidate_count: 0, exclude_count: 0 } } : {}),
      });
    }

    const systemPrompt = buildPromptOnlySystemPrompt(selectedGenres, promptText, requestNonce);
    const userMsg = `${promptText || `Recommend books in: ${selectedGenres.join(", ")}`}\n\n(Request nonce: ${requestNonce} — provide fresh picks)`;

    console.log(`[reading-copilot] request_id=${requestId} claude_call_start mode=prompt_only`);
    const { content, success, provider } = await callClaude(systemPrompt, userMsg, requestId);
    let recs: Recommendation[] = [];
    let llmUsed = false;
    let source = "fallback";
    let claudeCalled = true;

    if (success && content) {
      const parsed = extractJson(content);
      const rawPicks = parsed?.recommendations || (Array.isArray(parsed) ? parsed : null);

      if (rawPicks) {
        const { valid, errors } = validatePromptPicks(rawPicks as ClaudePromptPick[], selectedGenres);
        if (errors.length > 0) {
          console.warn(`[reading-copilot] request_id=${requestId} prompt_only_validation_errors: ${errors.join("; ")}`);
        }

        if (valid.length > 0) {
          recs = valid.map((p, idx) => ({
            id: `prompt-${requestId}-${idx}`,
            title: p.title, author: p.author, genre: p.genre || (selectedGenres[0] || "General"),
            tags: [], summary: p.why.join(". "), source: "recommendation_engine",
            reasons: p.why, why_new: p.why[0] || "",
          }));
          llmUsed = true;
          source = "claude";
          console.log(`[reading-copilot] request_id=${requestId} claude_call_success mode=prompt_only count=${recs.length} provider=${provider}`);
        }
      }

      // Retry if zero valid
      if (recs.length === 0) {
        console.log(`[reading-copilot] request_id=${requestId} prompt_only_invalid, retrying with correction`);
        const retryMsg = `Your previous response was invalid. ${userMsg}\nReturn ONLY valid JSON: {"recommendations":[{"title":"...","author":"...","genre":"...","why":["...","...","..."]}]}`;
        const retry = await callClaude(systemPrompt, retryMsg, requestId);
        if (retry.success && retry.content) {
          const p2 = extractJson(retry.content);
          const raw2 = p2?.recommendations || (Array.isArray(p2) ? p2 : null);
          if (raw2) {
            const v2 = validatePromptPicks(raw2 as ClaudePromptPick[], selectedGenres);
            if (v2.valid.length > 0) {
              recs = v2.valid.map((p, idx) => ({
                id: `prompt-${requestId}-r-${idx}`,
                title: p.title, author: p.author, genre: p.genre || (selectedGenres[0] || "General"),
                tags: [], summary: p.why.join(". "), source: "recommendation_engine",
                reasons: p.why, why_new: p.why[0] || "",
              }));
              llmUsed = true;
              source = "claude";
            }
          }
        }
      }
    } else {
      console.log(`[reading-copilot] request_id=${requestId} claude_call_failure mode=prompt_only`);
    }

    if (recs.length === 0) {
      console.warn(`[reading-copilot] request_id=${requestId} fallback_used mode=prompt_only`);
      return json({
        recommendations: [], mode: "prompt_only",
        warnings: ["Couldn't generate recommendations right now. Please try again or adjust your request."],
        ...(COPILOT_DEBUG ? { _debug: { request_id: requestId, claude_called: claudeCalled, llm_used: false, source: "failed", candidate_count: 0, exclude_count: 0 } } : {}),
      });
    }

    const matchScore = computeMatchScore(recs, selectedGenres, moodKeywords);
    await persistHistory(supabase, user.id, recs, requestId, llmUsed, source);
    console.log(`[reading-copilot] END request_id=${requestId} mode=prompt_only count=${recs.length} source=${source} llm_used=${llmUsed} match_score=${matchScore}`);

    return json({
      recommendations: recs, mode: "prompt_only",
      source: "recommendation_engine", warnings: [],
      ...(COPILOT_DEBUG ? { _debug: { request_id: requestId, claude_called: claudeCalled, llm_used: llmUsed, source, candidate_count: 0, exclude_count: 0, match_score: matchScore, chosen_ids: recs.map(r => r.id) } } : {}),
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PATH B: Library-based Claude-first recommendations
  // ════════════════════════════════════════════════════════════════════════════

  const rejectedTitles = new Set(
    feedback.filter(f => f.decision === "rejected").map(f => normalize(f.title))
  );

  let eligible = allBooks.filter(b => {
    const s = normalize(b.status || "tbr");
    if (s === "finished" || s === "read") return false;
    if (rejectedTitles.has(normalize(b.title))) return false;
    return true;
  });

  const strictGenreMode = selectedGenres.length > 0;
  if (strictGenreMode) {
    const lowerGenres = new Set(selectedGenres.map(g => normalize(g)));
    eligible = eligible.filter(b => b.genre && lowerGenres.has(normalize(b.genre)));
  }

  if (eligible.length === 0) {
    eligible = allBooks.filter(b => {
      if (rejectedTitles.has(normalize(b.title))) return false;
      if (strictGenreMode && b.genre) {
        const lowerGenres = new Set(selectedGenres.map(g => normalize(g)));
        return lowerGenres.has(normalize(b.genre));
      }
      return true;
    });
  }

  console.log(`[reading-copilot] request_id=${requestId} eligible_count=${eligible.length} total_books=${allBooks.length} strict_genre=${strictGenreMode}`);

  if (eligible.length === 0) {
    return json({
      recommendations: [],
      warnings: strictGenreMode
        ? ["No books match your selected genre(s). Try a different genre or add more books."]
        : ["No eligible books found. Add books to your library to get recommendations."],
      ...(COPILOT_DEBUG ? { _debug: { request_id: requestId, claude_called: false, llm_used: false, source: "none", candidate_count: 0, exclude_count: 0 } } : {}),
    });
  }

  // ── Build frequency maps ──
  const authorCounts: Record<string, number> = {};
  const genreCounts: Record<string, number> = {};
  allBooks.forEach(b => {
    const ak = normalize(b.author);
    authorCounts[ak] = (authorCounts[ak] ?? 0) + 1 + (typeof b.rating === "number" && b.rating >= 4 ? 1 : 0);
    if (b.genre) { const gk = normalize(b.genre); genreCounts[gk] = (genreCounts[gk] ?? 0) + 1; }
  });

  // ── Rotation state ──
  const contextKey = `generate_picks|${selectedGenres.map(g => normalize(g)).sort().join(",")}|${moodKeywords.slice(0, 3).sort().join(",")}`;
  const eligibleHash = hashIds(eligible.map(b => b.id));
  let rotCtx = rotationState[contextKey] as RotationContext | undefined;
  const now = new Date();
  const staleMs = 24 * 60 * 60 * 1000;
  const needsRebuild = !rotCtx || rotCtx.eligible_hash !== eligibleHash ||
    (new Date(rotCtx.updated_at).getTime() + staleMs < now.getTime());

  if (needsRebuild) {
    const cs = new Set(rotCtx?.cooldown_ids || []);
    const scored = eligible.map(b => ({
      book: b, score: scoreBook(b, authorCounts, genreCounts, rejectedTitles, selectedGenres, moodKeywords, cs),
    }));
    scored.sort((a, b) => b.score - a.score);
    rotCtx = {
      ranked_ids: scored.map(s => s.book.id), cursor: 0,
      cooldown_ids: [], eligible_hash: eligibleHash, updated_at: now.toISOString(),
    };
  }

  // Merge rotation cooldown with DB recent recs for comprehensive exclude
  const rotationCooldownSet = new Set(rotCtx!.cooldown_ids.slice(-9));
  const mergedExcludeSet = new Set([...rotationCooldownSet, ...dbExcludeSet]);
  const excludeIds = [...mergedExcludeSet];

  console.log(`[reading-copilot] request_id=${requestId} exclude_count=${excludeIds.length} (rotation=${rotationCooldownSet.size} db_recent=${dbExcludeSet.size})`);

  // ── Build candidates for Claude: remove excluded IDs, then take top 50 ──
  const eligibleAfterExclude = eligible.filter(b => !mergedExcludeSet.has(b.id));
  // If removing excludes leaves too few, allow some back
  const poolForScoring = eligibleAfterExclude.length >= FIXED_N ? eligibleAfterExclude : eligible;
  const topCandidates = poolForScoring
    .map(b => ({ book: b, score: scoreBook(b, authorCounts, genreCounts, rejectedTitles, selectedGenres, moodKeywords, mergedExcludeSet) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map(s => s.book);

  const candidateIds = new Set(topCandidates.map(b => b.id));
  const candidateMap = new Map(topCandidates.map(b => [b.id, b]));

  const topAuthors = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
  const topGenresArr = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

  const systemPrompt = buildLibrarySystemPrompt(selectedGenres, promptText, excludeIds, requestNonce);
  const candidateList = buildCandidateList(topCandidates);
  const userMsg = `User profile: top authors=[${topAuthors.join(", ")}], top genres=[${topGenresArr.join(", ")}], library size=${allBooks.length}

Candidate books (pick from these ONLY):
${candidateList}

${promptText ? `User's current request: "${promptText}"` : "User wants general recommendations from their library."}
${selectedGenres.length > 0 ? `Selected genres (STRICT — all picks must match): ${selectedGenres.join(", ")}` : ""}
${excludeIds.length > 0 ? `Recently shown (MUST AVOID these IDs): ${excludeIds.join(", ")}` : ""}

Select exactly 3 books. (Request nonce: ${requestNonce})`;

  console.log(`[reading-copilot] request_id=${requestId} claude_call_start mode=library candidate_count=${topCandidates.length} exclude_count=${excludeIds.length}`);
  const { content, success, provider } = await callClaude(systemPrompt, userMsg, requestId);
  let recs: Recommendation[] = [];
  let llmUsed = false;
  let source = "fallback";
  const claudeCalled = true;

  if (success && content) {
    const parsed = extractJson(content);
    const rawPicks = parsed?.recommendations || (Array.isArray(parsed) ? parsed : null);

    if (rawPicks) {
      const { valid, errors } = validateLibraryPicks(
        rawPicks as ClaudeLibraryPick[], candidateIds, selectedGenres, candidateMap, mergedExcludeSet, eligible.length,
      );
      if (errors.length > 0) {
        console.warn(`[reading-copilot] request_id=${requestId} claude_validation_errors: ${errors.join("; ")}`);
      }

      if (valid.length > 0) {
        recs = valid.map(pick => {
          const book = candidateMap.get(pick.book_id)!;
          return {
            id: book.id, title: book.title, author: book.author,
            genre: book.genre || "General", tags: [],
            summary: pick.why.join(". "), source: "recommendation_engine",
            reasons: pick.why, why_new: pick.why[0] || "",
          };
        });
        llmUsed = true;
        source = "claude";
        console.log(`[reading-copilot] request_id=${requestId} claude_call_success mode=library count=${recs.length} provider=${provider} chosen_ids=[${recs.map(r => r.id).join(",")}]`);
      }

      // Retry once if invalid
      if (recs.length === 0) {
        console.log(`[reading-copilot] request_id=${requestId} claude_validation_failed, retrying with correction`);
        const retryMsg = `Your previous response was invalid (errors: validation failed). Try again.
${userMsg}
Return ONLY: {"recommendations":[{"book_id":"<uuid from candidate list>","why":["bullet1","bullet2","bullet3"]}]}`;
        const retry = await callClaude(systemPrompt, retryMsg, requestId);
        if (retry.success && retry.content) {
          const p2 = extractJson(retry.content);
          const raw2 = p2?.recommendations || (Array.isArray(p2) ? p2 : null);
          if (raw2) {
            const v2 = validateLibraryPicks(raw2 as ClaudeLibraryPick[], candidateIds, selectedGenres, candidateMap, mergedExcludeSet, eligible.length);
            if (v2.valid.length > 0) {
              recs = v2.valid.map(pick => {
                const book = candidateMap.get(pick.book_id)!;
                return {
                  id: book.id, title: book.title, author: book.author,
                  genre: book.genre || "General", tags: [],
                  summary: pick.why.join(". "), source: "recommendation_engine",
                  reasons: pick.why, why_new: pick.why[0] || "",
                };
              });
              llmUsed = true;
              source = "claude";
              console.log(`[reading-copilot] request_id=${requestId} claude_call_success mode=library_retry count=${recs.length} provider=${retry.provider}`);
            }
          }
        }
      }
    }
  } else {
    console.log(`[reading-copilot] request_id=${requestId} claude_call_failure mode=library`);
  }

  // ── Fallback: scoring-based selection if Claude failed ──
  if (recs.length === 0) {
    console.log(`[reading-copilot] request_id=${requestId} fallback_used mode=library`);
    source = "fallback_scoring";

    const rankedIds = rotCtx!.ranked_ids;
    const eligibleMap = new Map(eligible.map(b => [b.id, b]));
    const selected: LibraryBook[] = [];
    let cursor = rotCtx!.cursor;
    let wrappedOnce = false;
    const startCursor = cursor;

    for (let attempts = 0; attempts < rankedIds.length * 2 && selected.length < FIXED_N; attempts++) {
      const idx = cursor % rankedIds.length;
      const bookId = rankedIds[idx];
      cursor++;
      if (cursor - startCursor >= rankedIds.length && !wrappedOnce) {
        wrappedOnce = true;
        if (selected.length < FIXED_N) mergedExcludeSet.clear();
      }
      const book = eligibleMap.get(bookId);
      if (!book) continue;
      if (mergedExcludeSet.has(bookId) && !wrappedOnce) continue;
      selected.push(book);
    }

    const whyCtx: WhyContext = { selectedGenres, moodText: promptText, moodKeywords, authorCounts, allBooks };
    const whyMap = buildAllFallbackWhyBullets(selected, whyCtx);

    recs = selected.map(book => ({
      id: book.id, title: book.title, author: book.author,
      genre: book.genre || "General", tags: [],
      summary: (whyMap.get(book.id) || []).join(". "), source: "recommendation_engine",
      reasons: whyMap.get(book.id) || [], why_new: (whyMap.get(book.id) || [])[0] || "",
    }));

    rotCtx!.cursor = cursor;
  }

  // ── Update rotation state ──
  const newCooldownIds = [...(rotCtx!.cooldown_ids || []), ...recs.map(r => r.id)].slice(-15);
  const updatedCtx: RotationContext = {
    ranked_ids: rotCtx!.ranked_ids,
    cursor: rotCtx!.cursor + (llmUsed ? recs.length : 0),
    cooldown_ids: newCooldownIds,
    eligible_hash: eligibleHash,
    updated_at: now.toISOString(),
  };
  const updatedRotationState = { ...rotationState, [contextKey]: updatedCtx };

  try {
    const { data: existingPrefs } = await (supabase as any)
      .from("copilot_preferences").select("id").eq("user_id", user.id).maybeSingle();
    if (existingPrefs) {
      await (supabase as any).from("copilot_preferences")
        .update({ rotation_state: updatedRotationState }).eq("user_id", user.id);
    } else {
      await (supabase as any).from("copilot_preferences")
        .insert({ user_id: user.id, rotation_state: updatedRotationState });
    }
  } catch (e) {
    console.warn(`[reading-copilot] request_id=${requestId} rotation_save_error:`, e);
  }

  const matchScore = computeMatchScore(recs, selectedGenres, moodKeywords);
  const dbOk = await persistHistory(supabase, user.id, recs, requestId, llmUsed, source);

  let genreLimitedMessage: string | null = null;
  if (strictGenreMode && eligible.length < 6) {
    genreLimitedMessage = "Limited matches in this genre—add another genre for more variety.";
  }

  console.log(`[reading-copilot] END request_id=${requestId} count=${recs.length} source=${source} llm_used=${llmUsed} match_score=${matchScore} chosen_ids=[${recs.map(r => r.id).join(",")}] db_write=${dbOk ? "ok" : "error"}`);

  return json({
    recommendations: recs,
    source: "recommendation_engine",
    warnings: dbOk ? [] : ["History write deferred"],
    ...(genreLimitedMessage ? { genre_limited_message: genreLimitedMessage } : {}),
    ...(COPILOT_DEBUG ? {
      _debug: {
        request_id: requestId,
        request_type: "generate_picks",
        selected_genres: selectedGenres,
        raw_tags: rawTags,
        claude_called: claudeCalled,
        llm_used: llmUsed,
        source,
        candidate_count: topCandidates.length,
        candidate_sample: topCandidates.slice(0, 5).map(b => ({
          id: b.id, title: b.title, genre: b.genre, status: b.status,
        })),
        exclude_count: excludeIds.length,
        excluded_ids: excludeIds.slice(0, 10),
        match_score: matchScore,
        chosen_ids: recs.map(r => r.id),
        validation_errors: [],
      },
    } : {}),
  });
});
