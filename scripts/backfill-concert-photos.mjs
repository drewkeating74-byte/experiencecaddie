/**
 * Backfill concert event photos from the Ticketmaster Discovery API into
 * events.image_url, and the attraction image into artists.image_url.
 *
 * Same pattern as scripts/backfill-golf-photos.mjs. DB access is via direct
 * Postgres (PG* env vars) — the same connection used previously. Re-runnable:
 * only targets rows where image_url IS NULL, so it's safe to run again after
 * the twice-monthly verify-packages cron inserts new events.
 *
 * Key: TM_API_KEY (falls back to TICKETMASTER_CONSUMER_KEY / TICKETMASTER_API_KEY).
 *
 * Usage:
 *   node scripts/backfill-concert-photos.mjs --dry-run --limit 3   # Gate 4 preview
 *   node scripts/backfill-concert-photos.mjs                       # full run
 *
 * NOTE: Ticketmaster's ToS prohibits *scheduled/automated* calls. This is an
 * operator-triggered, one-off backfill (consistent with the seed scripts).
 */
import pg from "pg";

const DRY_RUN = process.argv.includes("--dry-run");
const limitFlagIdx = process.argv.indexOf("--limit");
const LIMIT = limitFlagIdx !== -1 ? Number(process.argv[limitFlagIdx + 1]) : Infinity;

const TM_KEY =
  process.env.TM_API_KEY ||
  process.env.TICKETMASTER_CONSUMER_KEY ||
  process.env.TICKETMASTER_API_KEY;

const BATCH_SIZE = 100;
const RATE_PER_SEC = 5;                       // TM is stricter than Google
const MIN_INTERVAL_MS = 1000 / RATE_PER_SEC;  // 200ms

const WHERE = `source_name = 'ticketmaster' AND source_id IS NOT NULL AND image_url IS NULL`;

if (!TM_KEY) {
  console.error("Missing TM_API_KEY (or TICKETMASTER_CONSUMER_KEY / TICKETMASTER_API_KEY).");
  process.exit(1);
}

// ── Global rate limiter (≤ 5 req/s) ───────────────────────────────────────────
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

// ── Image selection ───────────────────────────────────────────────────────────
// Priority: ratio 16_9 + RETINA_LANDSCAPE > 16_9 + LANDSCAPE > 16_9 (any) >
// largest width. Real (non-fallback) images preferred over TM fallbacks.
// The `type` field is often absent on the event-detail endpoint, so the
// width tiebreak does most of the work in practice.
function pickBestImage(images) {
  if (!Array.isArray(images)) return null;
  const real = images.filter((i) => i && typeof i.url === "string" && i.url);
  if (real.length === 0) return null;
  const pool = real.some((i) => !i.fallback) ? real.filter((i) => !i.fallback) : real;
  const score = (img) => {
    let s = 0;
    if (img.ratio === "16_9") s += 1_000_000;
    if (img.type === "RETINA_LANDSCAPE") s += 20_000;
    else if (img.type === "LANDSCAPE") s += 10_000;
    s += Number(img.width) || 0;
    return s;
  };
  return pool.slice().sort((a, b) => score(b) - score(a))[0].url;
}

async function fetchTmEvent(eventId) {
  await throttle();
  const url = `https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(eventId)}?apikey=${encodeURIComponent(TM_KEY)}`;
  const res = await fetch(url);
  if (res.status === 404) return { notFound: true };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TM ${res.status}: ${body.slice(0, 200)}`);
  }
  return { data: await res.json() };
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
  eventsUpdated: 0,
  eventsNoImage: 0,
  notFound: 0,
  artistsUpdated: 0,
  artistsSkipped: 0,
  errors: 0,
};
const errorSamples = [];
const artistsTouched = new Set();

function logProgress(total) {
  console.log(
    `Progress: ${stats.processed}/${total} | Events: ${stats.eventsUpdated} | ` +
    `Artists: ${stats.artistsUpdated} | No image: ${stats.eventsNoImage} | ` +
    `404: ${stats.notFound} | Errors: ${stats.errors}`
  );
}

async function run() {
  await client.connect();

  const { rows: countRows } = await client.query(
    `SELECT count(*)::int AS n FROM public.events WHERE ${WHERE};`
  );
  const candidateTotal = countRows[0].n;
  const total = Math.min(candidateTotal, LIMIT);
  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Concert events needing photos: ${candidateTotal}` +
    `${LIMIT !== Infinity ? ` (processing first ${total})` : ""}\n`
  );

  let lastId = "00000000-0000-0000-0000-000000000000";

  while (stats.processed < total) {
    const pageSize = Math.min(BATCH_SIZE, total - stats.processed);
    const { rows } = await client.query(
      `SELECT id, name, source_id, artist_id
         FROM public.events
        WHERE ${WHERE} AND id > $1
        ORDER BY id ASC
        LIMIT $2;`,
      [lastId, pageSize]
    );
    if (rows.length === 0) break;

    for (const ev of rows) {
      lastId = ev.id;
      try {
        const { data, notFound } = await fetchTmEvent(ev.source_id);
        if (notFound) {
          stats.notFound++;
          stats.eventsNoImage++;
          if (DRY_RUN) console.log(`\n• ${ev.name} (${ev.source_id})\n   TM 404 — event not found`);
        } else {
          const eventImg = pickBestImage(data.images);
          const attraction = data?._embedded?.attractions?.[0];
          const artistImg = pickBestImage(attraction?.images);

          if (eventImg) stats.eventsUpdated++;
          else stats.eventsNoImage++;

          if (DRY_RUN) {
            console.log(
              `\n• ${ev.name} (${ev.source_id})\n` +
              `   event image_url   : ${eventImg ?? "NULL (no image returned)"}\n` +
              `   artist (${ev.artist_id ?? "no artist_id"}) image: ${artistImg ?? "NULL"}`
            );
          } else {
            if (eventImg) {
              await client.query(
                `UPDATE public.events SET image_url = $1, updated_at = now() WHERE id = $2;`,
                [eventImg, ev.id]
              );
            }
            // Update artist image only when still NULL (dedupe + no clobber).
            if (artistImg && ev.artist_id) {
              const r = await client.query(
                `UPDATE public.artists
                    SET image_url = $1, updated_at = now()
                  WHERE id = $2 AND image_url IS NULL;`,
                [artistImg, ev.artist_id]
              );
              if (r.rowCount > 0) {
                stats.artistsUpdated++;
                artistsTouched.add(ev.artist_id);
              } else {
                stats.artistsSkipped++;
              }
            }
          }
        }
      } catch (err) {
        stats.errors++;
        const msg = `${ev.name} (${ev.source_id}): ${err.message}`;
        if (errorSamples.length < 20) errorSamples.push(msg);
        console.error(`  ! ERROR ${msg}`);
      }

      stats.processed++;
      if (stats.processed % 20 === 0 || stats.processed === total) logProgress(total);
    }
  }

  console.log("\n────────────────────────────────────────");
  console.log(`${DRY_RUN ? "DRY RUN " : ""}FINAL REPORT`);
  console.log("────────────────────────────────────────");
  console.log(`Events processed         : ${stats.processed}`);
  console.log(`Events updated (image)   : ${stats.eventsUpdated}`);
  console.log(`Events with no image     : ${stats.eventsNoImage}`);
  console.log(`  • of which TM 404'd    : ${stats.notFound}`);
  console.log(`Artists updated          : ${stats.artistsUpdated}`);
  console.log(`Artists skipped (had img): ${stats.artistsSkipped}`);
  console.log(`Errors                   : ${stats.errors}`);
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
