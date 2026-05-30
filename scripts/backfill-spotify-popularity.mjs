/**
 * Backfill Spotify artist popularity into public.artists.
 *
 * Powers the Packages page "top artists / high-demand" ranking (and is
 * available to the marketing agent for picking top upcoming shows). Stores
 * spotify_id, spotify_popularity (0-100), spotify_followers, spotify_synced_at.
 *
 * Auth: Spotify Client Credentials flow.
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
 *
 * DB access via direct Postgres (PG* env vars), same as the other backfills.
 *
 * Searches by DISTINCT artist name (the catalog has multiple rows per touring
 * act — one per city) and writes the result to every artist row sharing that
 * name. Re-runnable: by default only targets rows where spotify_id IS NULL.
 * Pass --refresh to re-sync every artist regardless.
 *
 * Usage:
 *   node scripts/backfill-spotify-popularity.mjs --dry-run --limit 5   # gate preview
 *   node scripts/backfill-spotify-popularity.mjs                       # full run (unsynced only)
 *   node scripts/backfill-spotify-popularity.mjs --refresh             # re-sync everyone
 */
import pg from "pg";

const DRY_RUN = process.argv.includes("--dry-run");
const REFRESH = process.argv.includes("--refresh");
const limitFlagIdx = process.argv.indexOf("--limit");
const LIMIT = limitFlagIdx !== -1 ? Number(process.argv[limitFlagIdx + 1]) : Infinity;

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const RATE_PER_SEC = 8;
const MIN_INTERVAL_MS = 1000 / RATE_PER_SEC;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET.");
  process.exit(1);
}

// Distinct artist names to resolve. When --refresh is off we only resolve
// names that have at least one unsynced row, so re-runs are cheap.
const NAME_WHERE = REFRESH
  ? `name IS NOT NULL AND trim(name) <> ''`
  : `name IS NOT NULL AND trim(name) <> '' AND spotify_id IS NULL`;

// ── Rate limiter ────────────────────────────────────────────────────────────
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

// ── Spotify auth (client credentials) ─────────────────────────────────────────
let accessToken = null;
let tokenExpiresAt = 0;
async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 5000) return accessToken;
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify token ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return accessToken;
}

// ── Artist match ──────────────────────────────────────────────────────────────
// Prefer an exact (case-insensitive) name match among the top results; fall
// back to the first result (Spotify ranks by relevance/popularity).
function pickArtist(items, queryName) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const norm = (s) => (s || "").trim().toLowerCase();
  const exact = items.find((a) => norm(a.name) === norm(queryName));
  return exact ?? items[0];
}

async function searchArtist(name) {
  await throttle();
  const token = await getToken();
  const url =
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

// ── DB ─────────────────────────────────────────────────────────────────────────
const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

const stats = {
  processed: 0,
  matched: 0,
  noMatch: 0,
  rowsUpdated: 0,
  errors: 0,
};
const errorSamples = [];
const noMatchSamples = [];

function logProgress(total) {
  console.log(
    `Progress: ${stats.processed}/${total} | Matched: ${stats.matched} | ` +
    `No match: ${stats.noMatch} | Rows updated: ${stats.rowsUpdated} | Errors: ${stats.errors}`
  );
}

async function run() {
  await client.connect();

  const { rows: nameRows } = await client.query(
    `SELECT DISTINCT name FROM public.artists WHERE ${NAME_WHERE} ORDER BY name;`
  );
  const total = Math.min(nameRows.length, LIMIT);
  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Distinct artist names to resolve: ${nameRows.length}` +
    `${LIMIT !== Infinity ? ` (processing first ${total})` : ""}` +
    `${REFRESH ? " [--refresh: all]" : " [unsynced only]"}\n`
  );

  for (let i = 0; i < total; i++) {
    const name = nameRows[i].name;
    try {
      const artist = await searchArtist(name);
      if (!artist) {
        stats.noMatch++;
        if (noMatchSamples.length < 30) noMatchSamples.push(name);
        if (DRY_RUN) console.log(`\n• ${name}\n   no Spotify match`);
      } else {
        stats.matched++;
        const popularity = Number.isFinite(artist.popularity) ? artist.popularity : null;
        const followers = Number.isFinite(artist?.followers?.total) ? artist.followers.total : null;
        if (DRY_RUN) {
          console.log(
            `\n• ${name}\n` +
            `   -> "${artist.name}" (id ${artist.id})\n` +
            `   popularity: ${popularity ?? "n/a"} | followers: ${followers ?? "n/a"}`
          );
        } else {
          const r = await client.query(
            `UPDATE public.artists
                SET spotify_id = $1,
                    spotify_popularity = $2,
                    spotify_followers = $3,
                    spotify_synced_at = now(),
                    updated_at = now()
              WHERE name = $4;`,
            [artist.id, popularity, followers, name]
          );
          stats.rowsUpdated += r.rowCount;
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

  console.log("\n────────────────────────────────────────");
  console.log(`${DRY_RUN ? "DRY RUN " : ""}FINAL REPORT`);
  console.log("────────────────────────────────────────");
  console.log(`Names processed       : ${stats.processed}`);
  console.log(`Matched on Spotify    : ${stats.matched}`);
  console.log(`No match              : ${stats.noMatch}`);
  console.log(`Artist rows updated   : ${stats.rowsUpdated}`);
  console.log(`Errors                : ${stats.errors}`);
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
