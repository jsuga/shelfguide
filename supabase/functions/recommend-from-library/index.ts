import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ───────────────────────────────────────────────────────────────────

type TbrCandidate = {
  id: string;
  title: string;
  author: string;
  genre: string | null;
  series_name: string | null;
  google_volume_id: string | null;
  tags?: string[];
};

type RecommendationOut = {
  id: string;
  title: string;
  author: string;
  genre: string;
  tags: string[];
  google_volume_id: string | null;
  reasons: string[];
  source: string;
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

// ─── Seeded shuffle ──────────────────────────────────────────────────────────

const seededRng = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
};

const seededShuffle = <T>(arr: T[], seed: number): T[] => {
  const a = [...arr];
  const rng = seededRng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ─── Hardened JSON extraction ────────────────────────────────────────────────

const extractJson = (text: string): any => {
  try { return JSON.parse(text.trim()); } catch { /* continue */ }
  const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(stripped); } catch { /* continue */ }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch { /* continue */ }
  }
  return null;
};

// ─── Fetch with retry + exponential backoff ──────────────────────────────────

const fetchWithRetry = async (
  url: string, init: RequestInit, maxRetries = 3, timeoutMs = 18000
): Promise<Response> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        const body = await res.text().catch(() => "");
        console.warn(`[recommend-from-library] Attempt ${attempt + 1} failed: ${res.status} ${body}`);
        lastError = new Error(`HTTP ${res.status}: ${body}`);
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
      }
      return res;
    } catch (err) {
      console.warn(`[recommend-from-library] Attempt ${attempt + 1} error:`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  throw lastError || new Error("Fetch failed after retries");
};

// ─── Get recent recommendation book IDs to exclude ──────────────────────────

const getRecentExcludes = async (
  client: any,
  userId: string,
): Promise<Set<string>> => {
  try {
    const { data } = await client
      .from("copilot_recommendations")
      .select("book_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12); // last ~4 batches of 3 for strong rotation
    if (data && data.length > 0) {
      return new Set(data.map((r: any) => r.book_id).filter(Boolean));
    }
  } catch (e) {
    console.warn("[recommend-from-library] Failed to fetch recent excludes:", e);
  }
  return new Set();
};

// ─── Smart fallback pick with reasons ────────────────────────────────────────

const smartFallbackPick = (
  candidates: TbrCandidate[],
  n: number,
  seed: number,
  selectedGenres: string[],
  moodText: string,
): RecommendationOut[] => {
  const shuffled = seededShuffle(candidates, seed);
  const picks = shuffled.slice(0, n);

  return picks.map((c) => {
    const reasons: string[] = [];
    if (c.genre && selectedGenres.length > 0) {
      reasons.push(`Matches your selected genre: ${c.genre}`);
    } else if (c.genre) {
      reasons.push(`A great ${c.genre} pick from your TBR`);
    } else {
      reasons.push("Waiting on your TBR — give it a try");
    }
    if (moodText) {
      reasons.push(`Fits your mood: ${moodText.slice(0, 40)}`);
    } else if (c.series_name) {
      reasons.push(`Continue the ${c.series_name} series`);
    } else {
      reasons.push(`By ${c.author} — a solid choice`);
    }
    return {
      id: c.id,
      title: c.title,
      author: c.author,
      genre: c.genre || "General",
      tags: [],
      google_volume_id: c.google_volume_id || null,
      reasons,
      source: "recommendation_engine",
    };
  });
};

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // ── Generate request_id for tracing ──
  const requestId = crypto.randomUUID();
  const body = await req.json().catch(() => ({} as any));
  const debugMode = Boolean(body.debug);
  const selectedGenres: string[] = Array.isArray(body.genres) ? body.genres : [];
  const moodText: string = typeof body.mood === "string" ? body.mood : "";

  // ── Generate a cryptographically unique seed for this request ──
  const seedArr = new Uint32Array(1);
  crypto.getRandomValues(seedArr);
  const seed = seedArr[0];

  console.log(`[recommend-from-library] START request_id=${requestId} genres=${JSON.stringify(selectedGenres)} mood=${moodText.slice(0, 50)}`);

  // ── Auth ──
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

  console.log(`[recommend-from-library] request_id=${requestId} user_id=${user.id}`);

  // ── Fetch ALL user's TBR books ──
  const { data: tbrData, error: tbrError } = await (supabase as any)
    .from("books")
    .select("id, title, author, genre, series_name, google_volume_id")
    .eq("user_id", user.id)
    .eq("status", "tbr")
    .order("created_at", { ascending: false })
    .limit(500);

  if (tbrError) {
    console.error(`[recommend-from-library] request_id=${requestId} DB error:`, tbrError);
    return json({ error: "Failed to load your TBR list." }, 500);
  }

  const allTbr: TbrCandidate[] = (tbrData || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    genre: row.genre || null,
    series_name: row.series_name || null,
    google_volume_id: row.google_volume_id || null,
  }));

  if (allTbr.length === 0) {
    console.log(`[recommend-from-library] request_id=${requestId} no TBR books`);
    return json({
      recommendations: [],
      llm_used: false,
      provider: "none",
      model: null,
      is_tbr_strict: true,
      tbr_total: 0,
      target_n: 0,
      warnings: ["You have no TBR books. Add books with status 'TBR' to get recommendations."],
    });
  }

  // ── Always return exactly 3 (or fewer if pool is small) ──
  const FIXED_N = 3;

  // ── Filter by selected genres if provided (STRICT: no off-genre fills) ──
  let genreFiltered: TbrCandidate[];
  const strictGenreMode = selectedGenres.length > 0 && !selectedGenres.includes("Any");
  if (strictGenreMode) {
    const lowerGenres = new Set(selectedGenres.map((g) => g.toLowerCase()));
    genreFiltered = allTbr.filter((c) => c.genre && lowerGenres.has(c.genre.toLowerCase()));
  } else {
    genreFiltered = allTbr;
  }

  console.log(`[recommend-from-library] request_id=${requestId} eligibility_count=${genreFiltered.length} tbr_total=${allTbr.length} strict_genre=${strictGenreMode}`);

  // ── Get recent excludes ──
  const recentExcludes = await getRecentExcludes(supabase as any, user.id);

  console.log(`[recommend-from-library] request_id=${requestId} exclude_count=${recentExcludes.size}`);

  // ── Build candidate pool with exclude logic ──
  const freshGenreFiltered = genreFiltered.filter((c) => !recentExcludes.has(c.id));

  let candidates: TbrCandidate[];
  if (freshGenreFiltered.length >= FIXED_N) {
    candidates = seededShuffle(freshGenreFiltered, seed).slice(0, FIXED_N);
  } else if (genreFiltered.length >= FIXED_N) {
    const fresh = seededShuffle(freshGenreFiltered, seed);
    const remaining = seededShuffle(
      genreFiltered.filter((c) => recentExcludes.has(c.id)),
      seed + 1
    );
    candidates = [...fresh, ...remaining].slice(0, FIXED_N);
  } else {
    candidates = seededShuffle(genreFiltered, seed);
  }

  const finalN = candidates.length;

  // Build a friendly message if fewer than 3 match
  let genreLimitedMessage: string | null = null;
  if (strictGenreMode && genreFiltered.length < FIXED_N) {
    genreLimitedMessage = `Only ${genreFiltered.length} book${genreFiltered.length === 1 ? '' : 's'} match${genreFiltered.length === 1 ? 'es' : ''} your selected genre${selectedGenres.length > 1 ? 's' : ''}—try adding another genre for more options.`;
  }

  console.log(`[recommend-from-library] request_id=${requestId} selected_book_ids=${candidates.map(c => c.id).join(",")}`);

  // ── Check Anthropic key ──
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";

  const debugInfo: any = debugMode ? {
    request_id: requestId,
    provider_attempted: "none",
    model_attempted: null,
    candidate_count: candidates.length,
    tbr_total: allTbr.length,
    target_n: finalN,
    seed,
    exclude_count: recentExcludes.size,
    raw_llm_text: null,
    parse_attempts: [] as string[],
    anthropic_status: null,
  } : null;

  if (!anthropicKey) {
    const recs = smartFallbackPick(candidates, finalN, seed, selectedGenres, moodText);
    const dbOk = await persistRecommendations(supabase as any, user.id, recs, requestId);
    return json({
      recommendations: recs, llm_used: false, provider: "recommendation_engine", model: null,
      is_tbr_strict: true, tbr_total: allTbr.length, target_n: finalN,
      warnings: dbOk ? [] : ["History write deferred"],
      ...(genreLimitedMessage ? { genre_limited_message: genreLimitedMessage } : {}),
      ...(debugInfo ? { debug: debugInfo } : {}),
    });
  }

  // ── Build Claude prompt ──
  if (debugInfo) { debugInfo.provider_attempted = "anthropic"; debugInfo.model_attempted = anthropicModel; }

  const candidateList = candidates.map((c) => ({
    id: c.id, title: c.title, author: c.author, genre: c.genre || "General",
  }));

  const excludeIds = Array.from(recentExcludes).slice(0, 10);
  const systemPrompt = [
    "You are a book recommendation engine. You MUST select books ONLY from the candidate list provided.",
    "Return ONLY valid JSON. No markdown. No code fences. No commentary.",
    "",
    "HARD RULE: Every recommended_id MUST match a candidate id exactly.",
    "",
    "Required JSON schema:",
    '{"recommended_ids": ["string"], "reasons_by_id": {"<id>": ["reason1", "reason2"]}}',
    "",
    "Each reason must be max 15 words. Give exactly 2 reasons per book.",
    `Select exactly ${finalN} books from the candidates.`,
    "IMPORTANT: Provide a DIFFERENT selection each time. Vary your choices.",
    excludeIds.length > 0 ? `Avoid these recently-shown IDs if possible: ${excludeIds.slice(0, 10).join(", ")}` : "",
    moodText ? `The reader's current mood: "${moodText}"` : "",
    "If uncertain, still output valid JSON. Never output anything other than JSON.",
  ].filter(Boolean).join("\n");

  const userPrompt = JSON.stringify({
    task: `Pick the ${finalN} best books to read next from my TBR list.`,
    candidates: candidateList,
    seed,
    variation_hint: "Provide a different mix than last time.",
  });

  // ── Call Claude ──
  let llmSuccess = false;
  let validRecs: RecommendationOut[] = [];

  try {
    const llmResponse = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 1200,
        temperature: 0.85,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 3, 18000);

    if (debugInfo) debugInfo.anthropic_status = llmResponse.status;

    if (llmResponse.ok) {
      const payload = await llmResponse.json();

      let rawText = "";
      if (Array.isArray(payload.content)) {
        rawText = payload.content
          .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
          .join("\n");
      }

      if (debugInfo) {
        debugInfo.raw_llm_text = rawText.slice(0, 5000);
        debugInfo.parse_attempts = [];
      }

      const parsed = extractJson(rawText);
      if (debugInfo) debugInfo.parse_attempts.push(parsed ? "extractJson: success" : "extractJson: failed");

      if (parsed && Array.isArray(parsed.recommended_ids)) {
        const candidateMap = new Map(candidates.map((c) => [c.id, c]));
        const reasonsMap: Record<string, string[]> = parsed.reasons_by_id || {};

        for (const rid of parsed.recommended_ids) {
          if (typeof rid !== "string") continue;
          const match = candidateMap.get(rid);
          if (!match) {
            console.warn(`[recommend-from-library] request_id=${requestId} Filtering invalid ID: ${rid}`);
            continue;
          }
          const llmReasons = Array.isArray(reasonsMap[rid])
            ? reasonsMap[rid].map(String).slice(0, 3)
            : [];
          // Ensure "why" always exists
          const reasons = llmReasons.length > 0 ? llmReasons : [];
          if (match.genre && selectedGenres.length > 0) {
            reasons.unshift(`Matches your selected genre: ${match.genre}`);
          }
          if (moodText && !reasons.some(r => r.toLowerCase().includes("mood"))) {
            reasons.push(`Fits your mood: ${moodText.slice(0, 40)}`);
          }
          validRecs.push({
            id: match.id,
            title: match.title,
            author: match.author,
            genre: match.genre || "General",
            tags: [],
            google_volume_id: match.google_volume_id || null,
            reasons: reasons.slice(0, 3),
            source: "recommendation_engine",
          });
        }

        if (validRecs.length > 0) {
          llmSuccess = true;
          validRecs = validRecs.slice(0, finalN);
        }
      }
    } else {
      const errText = await llmResponse.text().catch(() => "");
      console.warn(`[recommend-from-library] request_id=${requestId} Anthropic error: ${llmResponse.status} ${errText}`);
    }
  } catch (err) {
    console.error(`[recommend-from-library] request_id=${requestId} Claude call failed:`, err);
  }

  // ── Fallback if Claude failed or returned no valid IDs ──
  if (!llmSuccess || validRecs.length === 0) {
    validRecs = smartFallbackPick(candidates, finalN, seed, selectedGenres, moodText);
  }

  // ── Persist to history ──
  const dbOk = await persistRecommendations(supabase as any, user.id, validRecs, requestId);

  console.log(`[recommend-from-library] END request_id=${requestId} llm_used=${llmSuccess} count=${validRecs.length} db_write=${dbOk ? "success" : "error"}`);

  return json({
    recommendations: validRecs,
    llm_used: llmSuccess,
    provider: llmSuccess ? "anthropic" : "recommendation_engine",
    model: llmSuccess ? anthropicModel : null,
    is_tbr_strict: true,
    tbr_total: allTbr.length,
    target_n: finalN,
    warnings: dbOk ? [] : ["History write deferred"],
    ...(genreLimitedMessage ? { genre_limited_message: genreLimitedMessage } : {}),
    ...(debugInfo ? { debug: debugInfo } : {}),
  });
});

// ─── Persist recommendations ─────────────────────────────────────────────────

async function persistRecommendations(
  client: any, userId: string, recs: RecommendationOut[], requestId: string
): Promise<boolean> {
  try {
    const historyPayload = recs.map((rec) => ({
      user_id: userId,
      book_id: rec.id,
      title: rec.title,
      author: rec.author,
      genre: rec.genre,
      tags: rec.tags || [],
      summary: rec.reasons.join(". "),
      source: rec.source,
      reasons: rec.reasons,
      why_new: "From your TBR list",
    }));
    const { error } = await client.from("copilot_recommendations").insert(historyPayload);
    if (error) {
      console.error(`[recommend-from-library] request_id=${requestId} db_write_error:`, error.message);
      return false;
    }
    console.log(`[recommend-from-library] request_id=${requestId} db_write_success count=${recs.length}`);
    return true;
  } catch (e) {
    console.error(`[recommend-from-library] request_id=${requestId} db_write_error:`, e);
    return false;
  }
}
