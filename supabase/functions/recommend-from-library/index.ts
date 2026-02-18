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

// ─── Smart fallback pick with reasons ────────────────────────────────────────

const smartFallbackPick = (candidates: TbrCandidate[], n: number): RecommendationOut[] => {
  // Shuffle candidates for variety on each call
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const picks = shuffled.slice(0, n);

  const reasonTemplates = [
    (c: TbrCandidate) => c.genre ? `A great ${c.genre} pick from your TBR` : "Waiting on your TBR — give it a try",
    (c: TbrCandidate) => c.series_name ? `Continue the ${c.series_name} series` : `By ${c.author} — a solid choice`,
    (_c: TbrCandidate) => "This one hasn't been recommended recently",
    (_c: TbrCandidate) => "A fresh pick to shake up your reading list",
  ];

  return picks.map((c) => {
    const r1 = reasonTemplates[Math.floor(Math.random() * reasonTemplates.length)](c);
    const r2 = reasonTemplates[Math.floor(Math.random() * reasonTemplates.length)](c);
    return {
      id: c.id,
      title: c.title,
      author: c.author,
      genre: c.genre || "General",
      tags: [],
      google_volume_id: c.google_volume_id || null,
      reasons: [r1, r2 !== r1 ? r2 : "A worthy addition to your reading queue"],
      source: "recommendation_engine",
    };
  });
};

// ─── Main handler ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({} as any));
  const n = Math.min(Math.max(Number(body.n) || 5, 1), 10);
  const debugMode = Boolean(body.debug);

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

  // ── Fetch user's TBR books (source of truth) ──
  const { data: tbrData, error: tbrError } = await (supabase as any)
    .from("books")
    .select("id, title, author, genre, series_name, google_volume_id")
    .eq("user_id", user.id)
    .eq("status", "tbr")
    .order("created_at", { ascending: false })
    .limit(120);

  if (tbrError) {
    console.error("[recommend-from-library] DB error:", tbrError);
    return json({ error: "Failed to load your TBR list." }, 500);
  }

  const candidates: TbrCandidate[] = (tbrData || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    genre: row.genre || null,
    series_name: row.series_name || null,
    google_volume_id: row.google_volume_id || null,
  }));

  if (candidates.length === 0) {
    return json({
      recommendations: [],
      llm_used: false,
      provider: "none",
      model: null,
      is_tbr_strict: true,
      warnings: ["You have no TBR books. Add books with status 'TBR' to get recommendations."],
    });
  }

  // ── Check Anthropic key ──
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const anthropicModel = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";

  const debugInfo: any = debugMode ? {
    provider_attempted: "none",
    model_attempted: null,
    candidate_count: candidates.length,
    raw_llm_text: null,
    parse_attempts: [] as string[],
    anthropic_status: null,
  } : null;

  if (!anthropicKey) {
    const recs = smartFallbackPick(candidates, n);
    return json({
      recommendations: recs, llm_used: false, provider: "recommendation_engine", model: null,
      is_tbr_strict: true,
      warnings: [],
      ...(debugInfo ? { debug: debugInfo } : {}),
    });
  }

  // ── Build Claude prompt ──
  if (debugInfo) { debugInfo.provider_attempted = "anthropic"; debugInfo.model_attempted = anthropicModel; }

  const candidateList = candidates.map((c) => ({
    id: c.id, title: c.title, author: c.author, genre: c.genre || "General",
  }));

  const systemPrompt = [
    "You are a book recommendation engine. You MUST select books ONLY from the candidate list provided.",
    "Return ONLY valid JSON. No markdown. No code fences. No commentary.",
    "",
    "HARD RULE: Every recommended_id MUST match a candidate id exactly.",
    "",
    "Required JSON schema:",
    '{"recommended_ids": ["string"], "reasons_by_id": {"<id>": ["reason1", "reason2"]}}',
    "",
    "Example valid response:",
    '{"recommended_ids": ["abc-123", "def-456"], "reasons_by_id": {"abc-123": ["Great pacing and worldbuilding", "Perfect for a cozy weekend"], "def-456": ["Acclaimed author you enjoy", "Fresh take on the genre"]}}',
    "",
    "Each reason must be max 15 words. Give exactly 2 reasons per book.",
    `Select exactly ${n} books from the candidates.`,
    "If uncertain, still output valid JSON. Never output anything other than JSON.",
  ].join("\n");

  const userPrompt = JSON.stringify({
    task: `Pick the ${n} best books to read next from my TBR list.`,
    candidates: candidateList,
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
        max_tokens: 800,
        temperature: 0.7,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 3, 18000);

    if (debugInfo) debugInfo.anthropic_status = llmResponse.status;

    if (llmResponse.ok) {
      const payload = await llmResponse.json();

      // Extract text from Anthropic content array
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
            console.warn(`[recommend-from-library] Filtering invalid ID: ${rid}`);
            continue;
          }
          validRecs.push({
            id: match.id,
            title: match.title,
            author: match.author,
            genre: match.genre || "General",
            tags: [],
            google_volume_id: match.google_volume_id || null,
            reasons: Array.isArray(reasonsMap[rid])
              ? reasonsMap[rid].map(String).slice(0, 3)
              : ["Recommended from your TBR"],
            source: "claude",
          });
        }

        if (validRecs.length > 0) {
          llmSuccess = true;
          validRecs = validRecs.slice(0, n);
        }
      }
    } else {
      const errText = await llmResponse.text().catch(() => "");
      console.warn("[recommend-from-library] Anthropic error:", llmResponse.status, errText);
    }
  } catch (err) {
    console.error("[recommend-from-library] Claude call failed:", err);
  }

  // ── Fallback if Claude failed or returned no valid IDs ──
  if (!llmSuccess || validRecs.length === 0) {
    validRecs = smartFallbackPick(candidates, n);
  }

  // ── Persist to history ──
  try {
    const historyPayload = validRecs.map((rec) => ({
      user_id: user.id,
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
    await (supabase as any).from("copilot_recommendations").insert(historyPayload);
  } catch (e) {
    console.warn("[recommend-from-library] Failed to persist history:", e);
  }

    return json({
    recommendations: validRecs,
    llm_used: llmSuccess,
    provider: llmSuccess ? "anthropic" : "recommendation_engine",
    model: llmSuccess ? anthropicModel : null,
    is_tbr_strict: true,
    warnings: [],
    ...(debugInfo ? { debug: debugInfo } : {}),
  });
});
