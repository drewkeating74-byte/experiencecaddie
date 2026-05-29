/**
 * Backfill golf-course photos from the Google Places API (Places API New).
 *
 * Reads courses that still need photos, fetches up to 3 photo URLs per course,
 * and writes them back into golf_courses (image_url, image_url_2, image_url_3),
 * also copying source_id -> place_id on every updated row.
 *
 * DB access: direct Postgres via PG* env vars (PGHOST, PGPORT, PGUSER,
 * PGPASSWORD, PGDATABASE) — same connection used for the migration. The
 * parameterized UPDATE uses $1..$4 placeholders (node-postgres), so a direct
 * Postgres connection is required (PostgREST can't do that).
 *
 * Google key: GOOGLE_PLACES_API_KEY (falls back to GOOGLE_API_KEY).
 *
 * Usage:
 *   node scripts/backfill-golf-photos.mjs --dry-run --limit 5   # Gate 5 preview
 *   node scripts/backfill-golf-photos.mjs                        # full run
 */
import pg from "pg";

// ── Config ───────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");
const limitFlagIdx = process.argv.indexOf("--limit");
const LIMIT = limitFlagIdx !== -1 ? Number(process.argv[limitFlagIdx + 1]) : Infinity;

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;

const BATCH_SIZE = 100;          // rows pulled from Postgres per page
const MAX_PHOTOS = 3;            // photo slots per course
const RATE_PER_SEC = 10;         // hard cap on Google API requests/second
const MIN_INTERVAL_MS = 1000 / RATE_PER_SEC;

const WHERE = `source = 'google_places' AND source_id IS NOT NULL AND image_url IS NULL`;

if (!GOOGLE_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY (or GOOGLE_API_KEY) in the environment.");
  process.exit(1);
}

// ── Global rate limiter (≤ 10 req/s across ALL Google calls) ──────────────────
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

// ── Google Places API New ─────────────────────────────────────────────────────
async function fetchPhotoNames(placeId) {
  await throttle();
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "photos",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Place details ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.photos ?? []).slice(0, MAX_PHOTOS).map((p) => p.name);
}

async function resolvePhotoUri(photoName) {
  await throttle();
  const url =
    `https://places.googleapis.com/v1/${photoName}/media` +
    `?maxHeightPx=1080&maxWidthPx=1920&key=${encodeURIComponent(GOOGLE_KEY)}&skipHttpRedirect=true`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Photo media ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.photoUri ?? null;
}

// ── Main ───────────────────────────────────────────────────────────────────────
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
  updated: 0,     // got >= 1 photo
  noPhotos: 0,    // valid place, zero photos returned
  errors: 0,
  got1: 0,
  got2: 0,
  got3: 0,
};
const errorSamples = [];

function logProgress(total) {
  console.log(
    `Progress: ${stats.processed}/${total} | Updated: ${stats.updated} | ` +
    `No photos: ${stats.noPhotos} | Errors: ${stats.errors}`
  );
}

async function run() {
  await client.connect();

  const { rows: countRows } = await client.query(
    `SELECT count(*)::int AS n FROM public.golf_courses WHERE ${WHERE};`
  );
  const candidateTotal = countRows[0].n;
  const total = Math.min(candidateTotal, LIMIT);
  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Candidates needing backfill: ${candidateTotal}` +
    `${LIMIT !== Infinity ? ` (processing first ${total})` : ""}\n`
  );

  let lastId = "00000000-0000-0000-0000-000000000000";

  while (stats.processed < total) {
    const pageSize = Math.min(BATCH_SIZE, total - stats.processed);
    const { rows } = await client.query(
      `SELECT id, name, source_id
         FROM public.golf_courses
        WHERE ${WHERE} AND id > $1
        ORDER BY id ASC
        LIMIT $2;`,
      [lastId, pageSize]
    );
    if (rows.length === 0) break;

    for (const course of rows) {
      lastId = course.id;
      try {
        const names = await fetchPhotoNames(course.source_id);
        const urls = [];
        for (const name of names) {
          const uri = await resolvePhotoUri(name);
          if (uri) urls.push(uri);
        }

        const slots = [urls[0] ?? null, urls[1] ?? null, urls[2] ?? null];

        if (urls.length === 0) {
          stats.noPhotos++;
        } else {
          stats.updated++;
          if (urls.length === 1) stats.got1++;
          else if (urls.length === 2) stats.got2++;
          else stats.got3++;
        }

        if (DRY_RUN) {
          console.log(
            `\n• ${course.name} (${course.source_id})\n` +
            `   photos found: ${urls.length}\n` +
            `   image_url  : ${slots[0] ?? "NULL"}\n` +
            `   image_url_2: ${slots[1] ?? "NULL"}\n` +
            `   image_url_3: ${slots[2] ?? "NULL"}`
          );
        } else {
          // Always copy source_id -> place_id; write photo slots (NULL-filled).
          await client.query(
            `UPDATE public.golf_courses
                SET place_id    = source_id,
                    image_url   = $1,
                    image_url_2 = $2,
                    image_url_3 = $3
              WHERE id = $4;`,
            [slots[0], slots[1], slots[2], course.id]
          );
        }
      } catch (err) {
        stats.errors++;
        const msg = `${course.name} (${course.source_id}): ${err.message}`;
        if (errorSamples.length < 20) errorSamples.push(msg);
        console.error(`  ! ERROR ${msg}`);
      }

      stats.processed++;
      if (stats.processed % 200 === 0 || stats.processed === total) logProgress(total);
    }
  }

  // ── Final report ──────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────");
  console.log(`${DRY_RUN ? "DRY RUN " : ""}FINAL REPORT`);
  console.log("────────────────────────────────────────");
  console.log(`Courses processed       : ${stats.processed}`);
  console.log(`Courses updated (≥1 pic) : ${stats.updated}`);
  console.log(`  • got exactly 1 photo  : ${stats.got1}`);
  console.log(`  • got exactly 2 photos : ${stats.got2}`);
  console.log(`  • got exactly 3 photos : ${stats.got3}`);
  console.log(`place_id but 0 photos    : ${stats.noPhotos}`);
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
