const required = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_ACCESS_TOKEN"];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const url = new URL("/functions/v1/reading-copilot", process.env.SUPABASE_URL);

const res = await fetch(url.toString(), {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,
    apikey: process.env.SUPABASE_ANON_KEY,
  },
  body: JSON.stringify({
    prompt: "cozy mystery",
    tags: ["cozy", "mystery"],
    surprise: 30,
    limit: 2,
  }),
});

if (!res.ok) {
  console.error(`Smoke test failed: ${res.status}`);
  try {
    const body = await res.text();
    console.error(body);
  } catch {
    // ignore
  }
  process.exit(1);
}

const data = await res.json();
if (!Array.isArray(data.recommendations)) {
  console.error("Smoke test failed: recommendations missing.");
  process.exit(1);
}

console.log("Smoke test passed.");
