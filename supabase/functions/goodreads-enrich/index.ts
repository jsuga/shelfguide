import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type EnrichRequest = {
  items: Array<{
    isbn?: string | null;
    isbn13?: string | null;
    title?: string | null;
    author?: string | null;
  }>;
};

type EnrichResult = {
  isbn?: string | null;
  isbn13?: string | null;
  title?: string | null;
  author?: string | null;
  description?: string | null;
  pageCount?: number | null;
  categories?: string[];
  thumbnail?: string | null;
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

const compact = (value: string | null | undefined) =>
  value ? value.trim() : "";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchGoogleBooks = async (query: string, key?: string | null) => {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("printType", "books");
  if (key) url.searchParams.set("key", key);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  const payload = await res.json();
  const item = Array.isArray(payload.items) ? payload.items[0] : null;
  if (!item) return null;
  return item.volumeInfo ?? null;
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

  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user;
  if (!user) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => ({ items: [] }))) as EnrichRequest;
  const items = Array.isArray(body.items) ? body.items.slice(0, 25) : [];
  const key = Deno.env.get("GOOGLE_BOOKS_API_KEY");

  const results: EnrichResult[] = [];
  for (const item of items) {
    const isbn = compact(item.isbn || "");
    const isbn13 = compact(item.isbn13 || "");
    const title = compact(item.title || "");
    const author = compact(item.author || "");
    let query = "";
    if (isbn13) query = `isbn:${isbn13}`;
    else if (isbn) query = `isbn:${isbn}`;
    else if (title && author) query = `intitle:${title} inauthor:${author}`;
    else if (title) query = `intitle:${title}`;

    let info: Record<string, unknown> | null = null;
    if (query) {
      info = (await fetchGoogleBooks(query, key)) as Record<string, unknown> | null;
      await sleep(150);
    }

    const imageLinks =
      info && typeof info.imageLinks === "object"
        ? (info.imageLinks as Record<string, unknown>)
        : null;

    results.push({
      isbn: isbn || null,
      isbn13: isbn13 || null,
      title: title || null,
      author: author || null,
      description: compact((info?.description as string | undefined) || ""),
      pageCount: typeof info?.pageCount === "number" ? (info.pageCount as number) : null,
      categories: Array.isArray(info?.categories) ? (info?.categories as string[]) : [],
      thumbnail: imageLinks?.thumbnail ? String(imageLinks.thumbnail) : null,
    });
  }

  return json({ results });
});
