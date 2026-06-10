/**
 * Backfill Fanart.tv artist background images into public.artists.
 *
 * Two-step process per artist:
 *
 *   Step 1 — MusicBrainz ID resolution (1 req/s, strict limit)
 *     GET https://musicbrainz.org/ws/2/artist?query=artist:{name}&limit=1&fmt=json
 *     Stores mbid in artists.musicbrainz_id. Skipped if already present.
 *
 *   Step 2 — Fanart.tv image fetch (5 req/s)
 *     GET https://webservice.fanart.tv/v3/music/{mbid}?api_key={FANART_API_KEY}
 *     Prefers artistbackground[0].url (wide cinematic live-performance shots).
 *     Falls back to artistthumb[0].url if no backgrounds exist.
 *     Stores result in artists.fanartv_background_url.
 *
 * MBIDs are written to the DB as they are found, so re-runs after interruption
 * skip already-resolved artists (musicbrainz_id IS NOT NULL guard on Step 1).
 * fanartv_background_url IS NULL guards Step 2 similarly.
 *
 * Final report distinguishes: background found / thumb fallback / no images /
 * no MusicBrainz match / Fanart.tv 404 (artist exists on MB but not Fanart.tv).
 *
 * DB credentials: PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)
 * API key: FANART_API_KEY
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-fanartv-images.mjs --dry-run --limit 5
 *   node --env-file=.env scripts/backfill-fanartv-images.mjs
 *   node --env-file=.env scripts/backfill-fanartv-images.mjs --refresh
 */
import pg from "pg";

// ── CLI flags ─────────────────────────────────────────────────────────────────
const DRY_RUN      = process.argv.includes("--dry-run");
const REFRESH      = process.argv.includes("--refresh");
const limitFlagIdx = process.argv.indexOf("--limit");
const LIMIT        = limitFlagIdx !== -1 ? Number(process.argv[limitFlagIdx + 1]) : Infinity;

// ── Config ────────────────────────────────────────────────────────────────────
const FANART_KEY = process.env.FANART_API_KEY;

// MusicBrainz: strictly 1 req/s for unauthenticated clients.
const MB_INTERVAL_MS     = 1100; // slightly over 1 s to be safe
// Fanart.tv: comfortable at 5 req/s.
const FANART_INTERVAL_MS = 200;

const FETCH_TIMEOUT_MS = 15_000;

if (!FANART_KEY) {
  console.error("Missing FANART_API_KEY in environment.");
  process.exit(1);
}

// ── Rate limiters (one per host) ──────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeThrottle(intervalMs) {
  let nextSlot = 0;
  return async function throttle() {
    const now  = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot   = Math.max(now, nextSlot) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
}

const throttleMB     = makeThrottle(MB_INTERVAL_MS);
const throttleFanart = makeThrottle(FANART_INTERVAL_MS);

// ── HTTP helper ───────────────────────────────────────────────────────────────
async function fetchJSON(url, headers = {}) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    return { status: res.status, data: res.ok ? await res.json() : null };
  } finally {
    clearTimeout(timer);
  }
}

// ── Step 1: MusicBrainz ───────────────────────────────────────────────────────
async function getMbid(name) {
  await throttleMB();
  const url = `https://musicbrainz.org/ws/2/artist?query=artist:${encodeURIComponent(name)}&limit=5&fmt=json`;
  const { status, data } = await fetchJSON(url, {
    "User-Agent": "ExperienceCaddie/1.0 (https://experiencecaddie.com)",
    Accept: "application/json",
  });
  if (status === 503) throw new Error("MusicBrainz 503 — rate limited");
  if (!data?.artists?.length) return null;

  // Prefer exact name match (case-insensitive), fall back to top result.
  const norm  = (s) => (s || "").trim().toLowerCase();
  const exact = data.artists.find((a) => norm(a.name) === norm(name));
  return (exact ?? data.artists[0]).id;
}

// ── Step 2: Fanart.tv ─────────────────────────────────────────────────────────
/**
 * Returns { url, type } where type is "background", "thumb", or null.
 */
async function getFanartImage(mbid) {
  await throttleFanart();
  const url = `https://webservice.fanart.tv/v3/music/${mbid}?api_key=${FANART_KEY}`;
  const { status, data } = await fetchJSON(url);

  if (status === 404) return { url: null, type: "not_on_fanart" };
  if (!data)          return { url: null, type: "error" };

  const backgrounds = data.artistbackground;
  if (Array.isArray(backgrounds) && backgrounds.length > 0) {
    // Fanart.tv returns images sorted by vote count descending — [0] is best.
    return { url: backgrounds[0].url, type: "background" };
  }

  const thumbs = data.artistthumb;
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    return { url: thumbs[0].url, type: "thumb" };
  }

  return { url: null, type: "no_images" };
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
  processed:      0,
  mbFound:        0,
  mbNotFound:     0,
  bgFound:        0,
  thumbFallback:  0,
  notOnFanart:    0,  // had mbid but Fanart.tv returned 404
  noImages:       0,  // on Fanart.tv but no background or thumb
  errors:         0,
};
const noMatchSamples = [];
const errorSamples   = [];

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  await client.connect();

  // Distinct names that still need work.
  // In --refresh mode, re-process everyone (clears both mb + fanart guards).
  // Normally: skip if fanartv_background_url is already set.
  const WHERE = REFRESH
    ? `name IS NOT NULL AND trim(name) <> ''`
    : `name IS NOT NULL AND trim(name) <> '' AND fanartv_background_url IS NULL`;

  const { rows: nameRows } = await client.query(
    `SELECT DISTINCT name, musicbrainz_id
       FROM public.artists
      WHERE ${WHERE}
      ORDER BY name`
  );
  const total = Math.min(nameRows.length, LIMIT);

  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Artists to process: ${nameRows.length}` +
    `${LIMIT !== Infinity ? ` (limit: ${LIMIT})` : ""}` +
    `${REFRESH ? " [--refresh]" : ""}\n`
  );

  for (let i = 0; i < total; i++) {
    const { name, musicbrainz_id: existingMbid } = nameRows[i];
    let mbid = existingMbid;

    try {
      // ── Step 1: resolve mbid if missing ──────────────────────────────────
      if (!mbid || REFRESH) {
        mbid = await getMbid(name);
        if (!mbid) {
          stats.mbNotFound++;
          if (noMatchSamples.length < 30) noMatchSamples.push(name);
          if (DRY_RUN) {
            console.log(`• ${name.padEnd(40)} → no MusicBrainz match`);
          }
          stats.processed++;
          continue;
        }
        stats.mbFound++;
        // Persist mbid immediately so re-runs skip this step.
        if (!DRY_RUN) {
          await client.query(
            `UPDATE public.artists SET musicbrainz_id = $1, updated_at = now() WHERE name = $2`,
            [mbid, name]
          );
        }
      } else {
        stats.mbFound++; // already had it
      }

      // ── Step 2: Fanart.tv ─────────────────────────────────────────────────
      const { url: imageUrl, type } = await getFanartImage(mbid);

      if (type === "background") stats.bgFound++;
      else if (type === "thumb")         stats.thumbFallback++;
      else if (type === "not_on_fanart") stats.notOnFanart++;
      else if (type === "no_images")     stats.noImages++;

      if (DRY_RUN) {
        const typeLabel = {
          background:    "background ✓",
          thumb:         "thumb (fallback)",
          not_on_fanart: "not on Fanart.tv",
          no_images:     "no images on Fanart.tv",
          error:         "Fanart.tv error",
        }[type] ?? type;
        console.log(
          `• ${name.padEnd(40)} mbid=${mbid}\n` +
          `  ${"".padEnd(42)}[${typeLabel}]${imageUrl ? "\n  " + "".padEnd(42) + imageUrl : ""}`
        );
      } else if (imageUrl) {
        await client.query(
          `UPDATE public.artists
              SET fanartv_background_url = $1, updated_at = now()
            WHERE name = $2 AND fanartv_background_url IS NULL`,
          [imageUrl, name]
        );
      }
    } catch (err) {
      stats.errors++;
      const msg = `${name}: ${err.message}`;
      if (errorSamples.length < 20) errorSamples.push(msg);
      console.error(`  ! ERROR ${msg}`);
    }

    stats.processed++;
    if (stats.processed % 10 === 0 || stats.processed === total) {
      console.log(
        `Progress: ${stats.processed}/${total} | ` +
        `bg: ${stats.bgFound} | thumb: ${stats.thumbFallback} | ` +
        `no fanart: ${stats.notOnFanart} | no MB: ${stats.mbNotFound} | ` +
        `errors: ${stats.errors}`
      );
    }
  }

  // ── Final report ───────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────────");
  console.log(`${DRY_RUN ? "DRY RUN " : ""}FINAL REPORT — Fanart.tv artist backgrounds`);
  console.log("────────────────────────────────────────────");
  console.log(`Artists processed                 : ${stats.processed}`);
  console.log(`MusicBrainz ID found              : ${stats.mbFound}`);
  console.log(`No MusicBrainz match              : ${stats.mbNotFound}`);
  console.log(`Fanart.tv background found        : ${stats.bgFound}`);
  console.log(`Fanart.tv thumb fallback used     : ${stats.thumbFallback}`);
  console.log(`On MusicBrainz, not on Fanart.tv  : ${stats.notOnFanart}`);
  console.log(`On Fanart.tv but no images        : ${stats.noImages}`);
  console.log(`Errors                            : ${stats.errors}`);
  console.log(
    `\nBannerBear coverage: ${stats.bgFound + stats.thumbFallback} of ${stats.processed} ` +
    `artists have a Fanart.tv image (${stats.processed - stats.mbNotFound - stats.notOnFanart - stats.noImages - stats.errors} resolved).`
  );
  if (noMatchSamples.length) {
    console.log(`\nNo MusicBrainz match (up to 30):`);
    noMatchSamples.forEach((n) => console.log(`  - ${n}`));
  }
  if (errorSamples.length) {
    console.log(`\nErrors (up to 20):`);
    errorSamples.forEach((e) => console.log(`  - ${e}`));
  }
}

run()
  .catch((err) => {
    console.error("FATAL:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
