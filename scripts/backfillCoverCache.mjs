import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_KEY = process.env.COVER_CACHE_ADMIN_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or COVER_CACHE_ADMIN_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const endpoint = `${SUPABASE_URL}/functions/v1/cache-book-cover`;
const batchSize = 10;
let offset = 0;
let processed = 0;

while (true) {
  const { data, error } = await supabase
    .from("books")
    .select("id")
    .is("cover_storage_path", null)
    .or("cover_url.not.is.null,thumbnail.not.is.null")
    .range(offset, offset + batchSize - 1);

  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = data || [];
  if (rows.length === 0) break;

  for (const row of rows) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify({ book_id: row.id }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`Cover cache failed for ${row.id}: ${errText}`);
    } else {
      processed += 1;
      console.log(`Cached cover for ${row.id}`);
    }
  }

  offset += batchSize;
}

console.log(`Backfill complete. Cached ${processed} cover(s).`);
