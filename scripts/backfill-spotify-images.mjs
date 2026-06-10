/**
 * Backfill Spotify artist images into public.artists.
 *
 * For each artist, searches Spotify and stores the largest available image
 * (images[0].url — Spotify returns images sorted largest-first, typically
 * 640×640 px or larger) in artists.spotify_image_url.
 *
 * These are professional marketing photographs, unlike the Ticketmaster press
 * headshots stored in events.image_url. Use spotify_image_url as the concert
 * slide background in BannerBear.
 *
 * Auth: Spotify Client Credentials flow.
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET (from .env)
 *
 * DB access via direct Postgres (PG* env vars).
 *
 * Re-runnable: only targets rows where spotify_image_url IS NULL by default.
 * Pass --refresh to re-sync every artist regardless.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-spotify-images.mjs --dry-run --limit 5
 *   node --env-file=.env scripts/backfill-spotify-images.mjs
 *   node --env-file=.env scripts/backfill-spotify-images.mjs --refresh
 */
import pg from "pg";

// ── CLI flags ─────────────────────────────────────────────────────────────────
const DRY_RUN      = process.argv.includes("--dry-run");
const REFRESH      = process.argv.includes("--refresh");
const limitFlagIdx = process.argv.indexOf("--limit");
const LIMIT        = limitFlagIdx !== -1 ? Number(process.argv[limitFlagIdx + 1]) : Infinity;

// ── Config ────────────────────────────────────────────────────────────────────
const CLIENT_ID     = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const RATE_PER_SEC  = 5;
const MIN_INTERVAL_MS = 1000 / RATE_PER_SEC;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET.");
  process.exit(1);
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now  = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot   = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

// ── Spotify auth (client credentials) ────────────────────────────────────────
let accessToken    = null;
let tokenExpiresAt = 0;
async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 5000) return accessToken;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization:  `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token ${res.status}: ${body.slice(0, 200)}`);
  }
  const data     = await res.json();
  accessToken    = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return accessToken;
}

// ── Artist search ─────────────────────────────────────────────────────────────
// Prefer an exact (case-insensitive) name match; fall back to top result.
function pickArtist(items, queryName) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const norm  = (s) => (s || "").trim().toLowerCase();
  const exact = items.find((a) => norm(a.name) === norm(queryName));
  return exact ?? items[0];
}

async function searchArtist(name) {
  await throttle();
  const token = await getToken();
  const url   =
    "https://api.spotify.com/v1/search?type=artist&limit=5&q=" +
    encodeURIComponent(name);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const retry = Number(res.headers.get("retry-after") || 2);
    await sleep((retry + 1) * 1000);
    return searchArtist(name);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify search ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return pickArtist(data?.artists?.items, name);
}

// ── DB ────────────────────────────────────────────────────────────────────────
const client = new pg.Client({
  host:     process.env.PGHOST,
  port:     Number(process.env.PGPORT || 5432),
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

// ── Stats ─────────────────────────────────────────────────────────────────────
const stats = {
  processed:   0,
  matched:     0,
  hasImage:    0,   // matched AND images[0] existed
  noImage:     0,   // matched but artist has no images on Spotify
  noMatch:     0,
  rowsUpdated: 0,
  errors:      0,
};
const noMatchSamples = [];
const errorSamples   = [];

function logProgress(total) {
  console.log(
    `Progress: ${stats.processed}/${total} | ` +
    `Matched: ${stats.matched} | Image found: ${stats.hasImage} | ` +
    `No match: ${stats.noMatch} | Rows updated: ${stats.rowsUpdated} | ` +
    `Errors: ${stats.errors}`
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const NAME_WHERE = REFRESH
  ? `name IS NOT NULL AND trim(name) <> ''`
  : `name IS NOT NULL AND trim(name) <> '' AND spotify_image_url IS NULL`;

async function run() {
  await client.connect();

  const { rows: nameRows } = await client.query(
    `SELECT DISTINCT name FROM public.artists WHERE ${NAME_WHERE} ORDER BY name;`
  );
  const total = Math.min(nameRows.length, LIMIT);
  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Distinct artist names to resolve: ${nameRows.length}` +
    `${LIMIT !== Infinity ? ` (processing first ${total})` : ""}` +
    `${REFRESH ? " [--refresh: all]" : " [unscored only]"}\n`
  );

  for (let i = 0; i < total; i++) {
    const name = nameRows[i].name;
    try {
      const artist = await searchArtist(name);

      if (!artist) {
        stats.noMatch++;
        if (noMatchSamples.length < 30) noMatchSamples.push(name);
        if (DRY_RUN) console.log(`• ${name.padEnd(40)} → no Spotify match`);
      } else {
        stats.matched++;
        // Spotify returns images sorted largest-first.
        const imageUrl = artist.images?.[0]?.url ?? null;

        if (!imageUrl) {
          stats.noImage++;
          if (DRY_RUN) {
            console.log(
              `• ${name.padEnd(40)} → matched "${artist.name}" — no images on profile`
            );
          }
        } else {
          stats.hasImage++;
          if (DRY_RUN) {
            console.log(
              `• ${name.padEnd(40)} → "${artist.name}"\n` +
              `  ${"".padEnd(42)}${imageUrl}`
            );
          } else {
            // Write to every row sharing this name (catalog has one row per city per artist).
            const r = await client.query(
              `UPDATE public.artists
                  SET spotify_image_url = $1,
                      updated_at        = now()
                WHERE name = $2
                  AND spotify_image_url IS NULL`,
              [imageUrl, name]
            );
            stats.rowsUpdated += r.rowCount;
          }
        }
      }
    } catch (err) {
      stats.errors++;
      const msg = `${name}: ${err.message}`;
      if (errorSamples.length < 20) errorSamples.push(msg);
      console.error(`  ! ERROR ${msg}`);
    }

    stats.processed++;
    if (stats.processed % 10 === 0 || stats.processed === total) logProgress(total);
  }

  // ── Final report ───────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────");
  console.log(`${DRY_RUN ? "DRY RUN " : ""}FINAL REPORT`);
  console.log("────────────────────────────────────────");
  console.log(`Names processed            : ${stats.processed}`);
  console.log(`Matched on Spotify         : ${stats.matched}`);
  console.log(`  • Image URL found        : ${stats.hasImage}`);
  console.log(`  • No images on profile   : ${stats.noImage}`);
  console.log(`No Spotify match           : ${stats.noMatch}`);
  console.log(`Artist rows updated in DB  : ${stats.rowsUpdated}`);
  console.log(`Errors                     : ${stats.errors}`);
  if (noMatchSamples.length) {
    console.log(`\nNo-match names (up to 30):`);
    noMatchSamples.forEach((n) => console.log(`  - ${n}`));
  }
  if (errorSamples.length) {
    console.log(`\nError samples (up to 20):`);
    errorSamples.forEach((e) => console.log(`  - ${e}`));
  }
}

run()
  .catch((err) => {
    console.error("FATAL:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
