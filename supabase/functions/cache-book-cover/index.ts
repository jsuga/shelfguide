import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type CacheRequest = {
  book_id?: string | null;
  cover_url?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-requested-with, x-admin-key",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

const extensionFromContentType = (contentType: string | null) => {
  const normalized = (contentType || "").toLowerCase();
  if (normalized.includes("image/jpeg")) return "jpg";
  if (normalized.includes("image/png")) return "png";
  if (normalized.includes("image/webp")) return "webp";
  if (normalized.includes("image/gif")) return "gif";
  return "jpg";
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json({ error: "Supabase environment not configured." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const adminKey = Deno.env.get("COVER_CACHE_ADMIN_KEY");
  const providedAdminKey = req.headers.get("x-admin-key") ?? "";

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: authData } = await userClient.auth.getUser();
  const user = authData?.user ?? null;
  const adminMode = !user && adminKey && providedAdminKey === adminKey;
  if (!user && !adminMode) return json({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as CacheRequest;
  const bookId = body.book_id?.trim();
  if (!bookId) return json({ error: "Missing book_id." }, 400);

  const { data: book, error: bookError } = await serviceClient
    .from("books")
    .select("id,user_id,cover_url,thumbnail,cover_storage_path")
    .eq("id", bookId)
    .maybeSingle();
  if (bookError || !book) {
    return json({ error: "Book not found." }, 404);
  }
  if (!adminMode && user && book.user_id !== user.id) {
    return json({ error: "Forbidden." }, 403);
  }

  if (book.cover_storage_path) {
    const { data } = serviceClient.storage
      .from("book-covers")
      .getPublicUrl(book.cover_storage_path);
    return json({
      ok: true,
      cover_storage_path: book.cover_storage_path,
      public_url: data?.publicUrl || null,
    });
  }

  const sourceUrl = (body.cover_url || book.cover_url || book.thumbnail || "").trim();
  if (!sourceUrl) {
    await serviceClient
      .from("books")
      .update({
        cover_cache_status: "failed",
        cover_cache_error: "Missing cover URL.",
      })
      .eq("id", bookId);
    return json({ error: "Missing cover URL." }, 400);
  }

  await serviceClient
    .from("books")
    .update({ cover_cache_status: "pending", cover_cache_error: null })
    .eq("id", bookId);

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Cover download failed (${response.status})`);
    }
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.startsWith("image/")) {
      throw new Error("Cover URL did not return an image.");
    }
    const ext = extensionFromContentType(contentType);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const storagePath = `${book.user_id}/${book.id}.${ext}`;

    const { error: uploadError } = await serviceClient.storage
      .from("book-covers")
      .upload(storagePath, bytes, {
        upsert: true,
        contentType,
        cacheControl: "public, max-age=31536000",
      });
    if (uploadError) {
      throw new Error(uploadError.message);
    }

    await serviceClient
      .from("books")
      .update({
        cover_storage_path: storagePath,
        cover_cached_at: new Date().toISOString(),
        cover_cache_status: "cached",
        cover_cache_error: null,
      })
      .eq("id", bookId);

    const { data } = serviceClient.storage
      .from("book-covers")
      .getPublicUrl(storagePath);

    return json({
      ok: true,
      cover_storage_path: storagePath,
      public_url: data?.publicUrl || null,
    });
  } catch (error) {
    const message = (error as Error)?.message || "Cover cache failed.";
    await serviceClient
      .from("books")
      .update({
        cover_cache_status: "failed",
        cover_cache_error: message,
      })
      .eq("id", bookId);
    return json({ error: message }, 500);
  }
});
