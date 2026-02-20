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
  cooldown_ids: string[]; // last N shown IDs
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

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || null;
};

// Simple hash for eligible set comparison
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

// ─── Rate limiting ───────────────────────────────────────────────────────────

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

// ─── Quality Scoring ─────────────────────────────────────────────────────────

const scoreBook = (
  book: LibraryBook,
  authorCounts: Record<string, number>,
  genreCounts: Record<string, number>,
  rejectedTitles: Set<string>,
  selectedGenres: string[],
  moodKeywords: string[],
  cooldownSet: Set<string>,
): number => {
  let score = 50; // baseline

  // Author affinity: boost if user reads this author frequently or rated highly
  const authorKey = normalize(book.author);
  const authorFreq = authorCounts[authorKey] ?? 0;
  score += Math.min(authorFreq * 3, 15);

  // Genre match to selected (eligibility already enforces, but boost)
  if (selectedGenres.length > 0 && book.genre) {
    const g = normalize(book.genre);
    if (selectedGenres.some(sg => normalize(sg) === g)) score += 10;
  }

  // Genre affinity from library
  if (book.genre) {
    const genreFreq = genreCounts[normalize(book.genre)] ?? 0;
    score += Math.min(genreFreq * 2, 10);
  }

  // Mood keyword match against title/genre/description
  if (moodKeywords.length > 0) {
    const text = `${book.title} ${book.genre || ""} ${book.description || ""} ${book.series_name || ""}`.toLowerCase();
    const matches = moodKeywords.filter(kw => text.includes(kw)).length;
    score += matches * 5;
  }

  // Series continuity: boost if user has other books in same series
  if (book.series_name) score += 5;

  // Status preference: TBR > want_to_read > reading
  const status = normalize(book.status || "tbr");
  if (status === "tbr" || status === "want_to_read") score += 8;
  else if (status === "reading") score += 3;

  // Penalties
  if (status === "finished" || status === "read") score -= 30;
  if (rejectedTitles.has(normalize(book.title))) score -= 40;
  if (cooldownSet.has(book.id)) score -= 20;

  // Rating penalty: if user rated it low, don't recommend
  if (typeof book.rating === "number" && book.rating <= 2) score -= 25;

  // Shorter books get slight mood boost for "quick"/"fast" moods
  if (moodKeywords.some(k => ["quick", "fast", "short"].includes(k))) {
    if (book.page_count && book.page_count < 300) score += 5;
  }

  return score;
};

// ─── Evidence-based Why Builder ──────────────────────────────────────────────

type WhyContext = {
  selectedGenres: string[];
  moodText: string;
  moodKeywords: string[];
  authorCounts: Record<string, number>;
  allBooks: LibraryBook[];
};

/** Build candidate bullets for a single book, ordered by priority. */
const buildCandidateBullets = (
  book: LibraryBook,
  ctx: WhyContext,
  bookIndex: number,
): string[] => {
  const bullets: string[] = [];
  const genre = book.genre || "";

  // 1) Genre match (highest priority when genres selected)
  if (ctx.selectedGenres.length > 0 && genre) {
    const variants = [
      `Matches your selected genre: ${genre}`,
      `Sits right in the ${genre} category you chose`,
      `Exactly the ${genre} pick you're looking for`,
    ];
    bullets.push(variants[bookIndex % variants.length]);
  }

  // 2) Mood match (grounded in what we actually know)
  if (ctx.moodText && ctx.moodKeywords.length > 0) {
    const searchable = `${book.title} ${genre} ${book.description || ""} ${(book.tags || []).join(" ")} ${book.series_name || ""}`.toLowerCase();
    const matched = ctx.moodKeywords.filter(kw => searchable.includes(kw));

    if (matched.length > 0) {
      const variants = [
        `Fits your '${ctx.moodText.slice(0, 30)}' mood — its ${genre || "style"} aligns with keywords like "${matched.slice(0, 2).join(", ")}"`,
        `Great match for your "${ctx.moodText.slice(0, 30)}" request — ${matched[0]} vibes come through in its ${genre || "style"}`,
      ];
      bullets.push(variants[bookIndex % variants.length]);
    } else if (genre) {
      // Conservative fallback: mood + genre mapping
      bullets.push(`You asked for '${ctx.moodText.slice(0, 25)}' — ${genre} titles tend to deliver that feel`);
    }
  }

  // 3) Author affinity
  const authorKey = normalize(book.author);
  const authorFreq = ctx.authorCounts[authorKey] ?? 0;
  if (authorFreq >= 3) {
    const variants = [
      `You have ${authorFreq} books by ${book.author} — clearly a favorite`,
      `${book.author} is one of your most-read authors with ${authorFreq} titles in your library`,
      `A reliable pick from ${book.author}, who you've collected ${authorFreq} books from`,
    ];
    bullets.push(variants[bookIndex % variants.length]);
  } else if (authorFreq === 2) {
    const variants = [
      `You've enjoyed ${book.author} before — this continues that streak`,
      `Another title from ${book.author}, whose work you already own`,
    ];
    bullets.push(variants[bookIndex % variants.length]);
  }

  // 4) Series continuity (only if grounded)
  if (book.series_name && !book.is_first_in_series) {
    const hasOthersInSeries = ctx.allBooks.some(
      b => b.id !== book.id && b.series_name === book.series_name
    );
    if (hasOthersInSeries) {
      bullets.push(`Continues the ${book.series_name} series you've been reading`);
    }
  }

  // 5) TBR motivation
  const status = normalize(book.status || "tbr");
  if (status === "tbr" || status === "want_to_read") {
    const variants = [
      "Already on your TBR — a low-friction next read",
      "Sitting in your to-be-read pile, ready to go",
      "You added this to your TBR for a reason — now's the time",
    ];
    bullets.push(variants[bookIndex % variants.length]);
  }

  // 6) Page count insight (only if we have data)
  if (typeof book.page_count === "number" && book.page_count > 0) {
    if (book.page_count < 250) {
      bullets.push(`A quick read at ${book.page_count} pages — easy to finish`);
    } else if (book.page_count > 500) {
      bullets.push(`An immersive ${book.page_count}-page read for when you want to go deep`);
    }
  }

  // 7) Novelty / rotation bullet
  const variants = [
    `Fresh pick to break up your reading pattern${genre ? ` within ${genre}` : ""}`,
    `Rotated in for variety${genre ? ` — a different angle on ${genre}` : ""}`,
    `Something different from your recent recommendations${genre ? ` while staying in ${genre}` : ""}`,
  ];
  bullets.push(variants[bookIndex % variants.length]);

  return bullets;
};

/**
 * Build deduplicated why bullets for all selected books.
 * Returns a Map of bookId → string[] (exactly 3 bullets each, or 2 if data is scarce).
 */
const buildAllWhyBullets = (
  books: LibraryBook[],
  ctx: WhyContext,
): Map<string, string[]> => {
  const usedPhrases = new Set<string>();
  const result = new Map<string, string[]>();
  let seriesUsed = false;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const candidates = buildCandidateBullets(book, ctx, i);
    const chosen: string[] = [];

    for (const bullet of candidates) {
      if (chosen.length >= 3) break;

      const key = bullet.trim().toLowerCase();
      if (usedPhrases.has(key)) continue;

      // Series bullet: max once per response
      const isSeries = bullet.includes("series") && (bullet.includes("Continues") || bullet.includes("Next"));
      if (isSeries && seriesUsed) continue;

      chosen.push(bullet);
      usedPhrases.add(key);
      if (isSeries) seriesUsed = true;
    }

    // Ensure minimum 2 bullets
    if (chosen.length < 2) {
      const fallbacks = [
        `A standout title in your collection worth revisiting`,
        `Hand-picked from your library based on your reading history`,
      ];
      for (const fb of fallbacks) {
        if (chosen.length >= 2) break;
        const key = fb.toLowerCase();
        if (!usedPhrases.has(key)) {
          chosen.push(fb);
          usedPhrases.add(key);
        }
      }
    }

    result.set(book.id, chosen.slice(0, 3));
  }

  return result;
};

// ─── Persist history ─────────────────────────────────────────────────────────

const persistHistory = async (
  client: any, userId: string, recs: Recommendation[], requestId: string,
): Promise<boolean> => {
  if (!recs.length) return true;
  const payload = recs.map((rec) => ({
    user_id: userId, book_id: rec.id, title: rec.title, author: rec.author,
    genre: rec.genre, tags: rec.tags || [], summary: rec.summary, source: rec.source,
    reasons: rec.reasons || [], why_new: rec.why_new,
  }));
  try {
    const { error } = await client.from("copilot_recommendations").insert(payload);
    if (error) {
      console.error(`[reading-copilot] request_id=${requestId} db_write_error:`, error.message);
      return false;
    }
    console.log(`[reading-copilot] request_id=${requestId} db_write_success count=${recs.length}`);
    return true;
  } catch (e) {
    console.error(`[reading-copilot] request_id=${requestId} db_write_error:`, e);
    return false;
  }
};

// ─── Main handler ────────────────────────────────────────────────────────────

const FIXED_N = 3;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const requestId = crypto.randomUUID();
  const body = await req.json().catch(() => ({} as any));
  const debugMode = Boolean(body.debug);

  // ── Debug probe ──
  if (debugMode && !body.prompt && !body.tags) {
    return json({
      ok: true, function: "reading-copilot", request_id: requestId,
      env_present: {
        SUPABASE_URL: Boolean(Deno.env.get("SUPABASE_URL")),
        SUPABASE_ANON_KEY: Boolean(Deno.env.get("SUPABASE_ANON_KEY")),
        SUPABASE_SERVICE_ROLE_KEY: Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
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
  const selectedGenres: string[] = tagsArr
    .filter((t: string) => typeof t === "string")
    .map((t: string) => t.trim())
    .filter(Boolean);

  // Extract mood keywords
  const moodKeywords = promptText
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((w: string) => w.length > 2);

  console.log(`[reading-copilot] START request_id=${requestId} user_id=${user.id} request_type=generate_picks genres=${JSON.stringify(selectedGenres)} mood=${promptText.slice(0, 50)}`);

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

  // ── Fetch user's library + feedback + preferences ──
  const [booksRes, feedbackRes, prefsRes] = await Promise.all([
    (supabase as any).from("books").select("id,title,author,genre,series_name,status,rating,page_count,description")
      .eq("user_id", user.id).limit(1000),
    (supabase as any).from("copilot_feedback").select("book_id,title,author,genre,decision")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    (supabase as any).from("copilot_preferences").select("rotation_state")
      .eq("user_id", user.id).maybeSingle(),
  ]);

  const allBooks: LibraryBook[] = (booksRes.data || []) as LibraryBook[];
  const feedback: Feedback[] = (feedbackRes.data || []) as Feedback[];
  const rotationState: Record<string, RotationContext> =
    (prefsRes.data?.rotation_state as Record<string, RotationContext>) || {};

  if (allBooks.length === 0) {
    console.log(`[reading-copilot] request_id=${requestId} no library books`);
    return json({
      recommendations: [],
      warnings: ["Your library is empty. Add some books to get personalized recommendations."],
    });
  }

  // ── Build eligibility ──
  const rejectedTitles = new Set(
    feedback.filter(f => f.decision === "rejected").map(f => normalize(f.title))
  );

  // For generate_picks: prefer TBR/want_to_read, but include all non-finished
  let eligible = allBooks.filter(b => {
    const s = normalize(b.status || "tbr");
    // Exclude finished/read books (heavy penalty via score, but also filter for smaller pool)
    if (s === "finished" || s === "read") return false;
    // Exclude rejected
    if (rejectedTitles.has(normalize(b.title))) return false;
    return true;
  });

  // If genres selected → strict filter
  const strictGenreMode = selectedGenres.length > 0;
  if (strictGenreMode) {
    const lowerGenres = new Set(selectedGenres.map(g => normalize(g)));
    eligible = eligible.filter(b => b.genre && lowerGenres.has(normalize(b.genre)));
  }

  // If nothing eligible after filters, relax to include finished too
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
        ? [`No books match your selected genre(s). Try a different genre or add more books.`]
        : ["No eligible books found. Add books to your library to get recommendations."],
    });
  }

  // ── Build author/genre frequency maps ──
  const authorCounts: Record<string, number> = {};
  const genreCounts: Record<string, number> = {};
  allBooks.forEach(b => {
    const ak = normalize(b.author);
    authorCounts[ak] = (authorCounts[ak] ?? 0) + 1 + (typeof b.rating === "number" && b.rating >= 4 ? 1 : 0);
    if (b.genre) {
      const gk = normalize(b.genre);
      genreCounts[gk] = (genreCounts[gk] ?? 0) + 1;
    }
  });

  // ── Context key for rotation ──
  const contextKey = `generate_picks|${selectedGenres.map(g => normalize(g)).sort().join(",")}|${moodKeywords.slice(0, 3).sort().join(",")}`;

  // ── Get or rebuild rotation state for this context ──
  const eligibleHash = hashIds(eligible.map(b => b.id));
  let ctx = rotationState[contextKey] as RotationContext | undefined;
  const now = new Date();
  const staleMs = 24 * 60 * 60 * 1000; // 24h
  const needsRebuild = !ctx ||
    ctx.eligible_hash !== eligibleHash ||
    (new Date(ctx.updated_at).getTime() + staleMs < now.getTime());

  if (needsRebuild) {
    // Score all eligible books
    const cooldownSet = new Set(ctx?.cooldown_ids || []);
    const scored = eligible.map(b => ({
      book: b,
      score: scoreBook(b, authorCounts, genreCounts, rejectedTitles, selectedGenres, moodKeywords, cooldownSet),
    }));
    scored.sort((a, b) => b.score - a.score);

    ctx = {
      ranked_ids: scored.map(s => s.book.id),
      cursor: 0,
      cooldown_ids: [],
      eligible_hash: eligibleHash,
      updated_at: now.toISOString(),
    };

    console.log(`[reading-copilot] request_id=${requestId} rotation_rebuilt scored_top3=${scored.slice(0, 3).map(s => `${s.book.title}(${s.score})`).join(", ")}`);
  }

  // ── Select 3 using cursor + cooldown ──
  const rankedIds = ctx!.ranked_ids;
  const cooldownSet = new Set(ctx!.cooldown_ids.slice(-9)); // last 3 batches = 9 IDs
  const eligibleMap = new Map(eligible.map(b => [b.id, b]));

  const selected: LibraryBook[] = [];
  let cursor = ctx!.cursor;
  let wrappedOnce = false;
  const startCursor = cursor;

  // Walk through ranked list from cursor, picking non-cooldown books
  for (let attempts = 0; attempts < rankedIds.length * 2 && selected.length < FIXED_N; attempts++) {
    const idx = cursor % rankedIds.length;
    const bookId = rankedIds[idx];
    cursor++;

    // Detect full wrap
    if (cursor - startCursor >= rankedIds.length && !wrappedOnce) {
      wrappedOnce = true;
      // If we wrapped and still don't have 3, relax cooldown
      if (selected.length < FIXED_N) {
        cooldownSet.clear();
      }
    }

    const book = eligibleMap.get(bookId);
    if (!book) continue;
    if (cooldownSet.has(bookId) && !wrappedOnce) continue;

    selected.push(book);
  }

  // If eligible < FIXED_N, we might have fewer
  const finalN = selected.length;

  // Update cooldown: add newly selected IDs
  const newCooldownIds = [...(ctx!.cooldown_ids || []), ...selected.map(b => b.id)].slice(-15);

  // Limit to top ~40% for quality when pool is large
  // (Already handled by scored ranking — cursor walks top-scored first)


  // ── Build why bullets (evidence-based, deduplicated) ──
  const whyCtx: WhyContext = { selectedGenres, moodText: promptText, moodKeywords, authorCounts, allBooks };
  const whyMap = buildAllWhyBullets(selected, whyCtx);

  // ── Build recommendations ──
  const recs: Recommendation[] = selected.map((book) => {
    const bullets = whyMap.get(book.id) || [];
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      genre: book.genre || "General",
      tags: [],
      summary: bullets.join(". "),
      source: "recommendation_engine",
      reasons: bullets,
      why_new: bullets[0] || "A strong pick from your library",
    };
  });

  // ── Update rotation state ──
  const updatedCtx: RotationContext = {
    ranked_ids: rankedIds,
    cursor: cursor,
    cooldown_ids: newCooldownIds,
    eligible_hash: eligibleHash,
    updated_at: now.toISOString(),
  };
  const updatedRotationState = { ...rotationState, [contextKey]: updatedCtx };

  // Save rotation state
  try {
    // Check if preferences row exists
    const { data: existingPrefs } = await (supabase as any)
      .from("copilot_preferences")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingPrefs) {
      await (supabase as any)
        .from("copilot_preferences")
        .update({ rotation_state: updatedRotationState })
        .eq("user_id", user.id);
    } else {
      await (supabase as any)
        .from("copilot_preferences")
        .insert({ user_id: user.id, rotation_state: updatedRotationState });
    }
  } catch (e) {
    console.warn(`[reading-copilot] request_id=${requestId} rotation_state_save_error:`, e);
  }

  // ── Persist recommendation history ──
  const dbOk = await persistHistory(supabase, user.id, recs, requestId);

  // Genre limited message
  let genreLimitedMessage: string | null = null;
  if (strictGenreMode && eligible.length < 6) {
    genreLimitedMessage = `Limited matches in this genre—add another genre for more variety.`;
  }

  console.log(`[reading-copilot] END request_id=${requestId} count=${finalN} cursor=${cursor} cooldown=${newCooldownIds.length} db_write=${dbOk ? "ok" : "error"}`);

  return json({
    recommendations: recs,
    llm_used: false,
    source: "recommendation_engine",
    provider: "recommendation_engine",
    model: null,
    warnings: dbOk ? [] : ["History write deferred"],
    ...(genreLimitedMessage ? { genre_limited_message: genreLimitedMessage } : {}),
    ...(debugMode ? {
      debug: {
        request_id: requestId,
        eligible_count: eligible.length,
        cursor_before: startCursor,
        cursor_after: cursor,
        cooldown_size: newCooldownIds.length,
        context_key: contextKey,
        selected_ids: selected.map(b => b.id),
      },
    } : {}),
  });
});
