/**
 * Score Ticketmaster event images by brightness.
 *
 * For each ticketmaster event with image_url:
 *   1. Fetches the image at reduced size.
 *   2. Computes average pixel brightness via sharp (0 = black, 100 = white).
 *   3. Stores image_brightness_score on the events row.
 *      Images scoring > 70 are likely press headshots on white/grey backgrounds
 *      and should be skipped in the BannerBear pipeline in favour of a dark placeholder.
 *
 * DB credentials (add to your .env or export in shell before running):
 *   PGHOST     = aws-0-us-west-2.pooler.supabase.com
 *   PGPORT     = 5432
 *   PGUSER     = postgres.<project-id>   (Supabase pooler username)
 *   PGPASSWORD = <your db password>
 *   PGDATABASE = postgres
 *
 * Prerequisites:
 *   npm install pg sharp   (or: npm install --save-dev sharp)
 *
 * Usage:
 *   node --env-file=.env scripts/score-event-images.mjs --dry-run --limit 5
 *   node --env-file=.env scripts/score-event-images.mjs
 */
import pg from "pg";
import sharp from "sharp";

// ── CLI flags ─────────────────────────────────────────────────────────────────
const DRY_RUN  = process.argv.includes("--dry-run");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT    = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : Infinity;

// ── Config ────────────────────────────────────────────────────────────────────
const BATCH_SIZE      = 50;
const CONCURRENCY     = 6;
const TOO_BRIGHT_THRESHOLD = 70;  // scores above this flag as press-headshot risk
const FETCH_TIMEOUT_MS    = 12_000;

// Ticketmaster DAM images: swap the size suffix to get a smaller variant.
// Known suffixes (ascending size): RECOMENDATION, ARTIST_PAGE, TABLET_LANDSCAPE_3_2,
// TABLET_LANDSCAPE_16_9, etc.  We target TABLET_LANDSCAPE_3_2 (~640 × 427).
const TM_SIZE_SUFFIX = "_RECOMENDATION.jpg"; // ~70 × 70 px, tiny but enough for brightness

// ── DB ────────────────────────────────────────────────────────────────────────
if (!process.env.PGPASSWORD) {
  console.error("Missing PGPASSWORD. Set it via --env-file or export PGPASSWORD=...");
  process.exit(1);
}

const pool = new pg.Pool({
  host:     process.env.PGHOST     || "aws-0-us-west-2.pooler.supabase.com",
  port:     Number(process.env.PGPORT || 5432),
  user:     process.env.PGUSER     || "postgres",
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
  max: CONCURRENCY + 2,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Derive a smaller Ticketmaster image URL.
 * TM DAM URLs look like: https://s1.ticketm.net/dam/a/XXX/uuid_SUFFIX.jpg
 * We try to swap in RECOMENDATION; if the URL doesn't match the pattern, use as-is.
 */
function smallUrl(url) {
  return url.replace(/_[A-Z0-9_]+\.jpg$/i, TM_SIZE_SUFFIX);
}

/** Fetch image with timeout; returns null on error. */
async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fallback: if the RECOMENDATION variant 404s, try the original URL. */
async function fetchWithFallback(originalUrl) {
  const small = smallUrl(originalUrl);
  if (small !== originalUrl) {
    const buf = await fetchImage(small);
    if (buf) return buf;
  }
  return fetchImage(originalUrl);
}

/**
 * Compute average pixel brightness as a 0–100 float.
 * Converts to greyscale, resizes to 80 × 80, averages pixel values.
 */
async function brightness(buf) {
  const { data } = await sharp(buf)
    .resize(80, 80, { fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return Math.round((sum / data.length / 255) * 100 * 10) / 10;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
const stats = {
  processed: 0,
  scored: 0,
  tooBright: 0,
  skipped: 0,
  errors: 0,
  scoreDistribution: { "0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0 },
};

function bucketScore(s) {
  if (s <= 20) return "0-20";
  if (s <= 40) return "21-40";
  if (s <= 60) return "41-60";
  if (s <= 80) return "61-80";
  return "81-100";
}

// ── Core per-event logic ──────────────────────────────────────────────────────
async function processEvent(event) {
  const buf = await fetchWithFallback(event.image_url);
  if (!buf) {
    stats.skipped++;
    return;
  }

  let score;
  try {
    score = await brightness(buf);
  } catch {
    stats.skipped++;
    return;
  }

  stats.scored++;
  stats.scoreDistribution[bucketScore(score)]++;
  if (score > TOO_BRIGHT_THRESHOLD) stats.tooBright++;

  const flag = score > TOO_BRIGHT_THRESHOLD ? " ⚑ TOO BRIGHT" : "";

  if (DRY_RUN) {
    console.log(
      `• ${event.name.substring(0, 42).padEnd(42)} score=${score.toFixed(1).padStart(5)}${flag}`
    );
    return;
  }

  await pool.query(
    `UPDATE public.events
        SET image_brightness_score = $1,
            updated_at             = now()
      WHERE id = $2`,
    [score, event.id]
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  // Pool connects lazily — no explicit connect() needed.

  // Dry-run skips the IS NULL guard so it works before the migration is applied.
  const WHERE = DRY_RUN
    ? `source_name = 'ticketmaster' AND image_url IS NOT NULL AND image_url <> ''`
    : `source_name = 'ticketmaster' AND image_url IS NOT NULL AND image_url <> ''
         AND image_brightness_score IS NULL`;

  const { rows: [{ n }] } = await pool.query(
    `SELECT count(*)::int AS n FROM public.events WHERE ${WHERE}`
  );
  const total = Math.min(n, LIMIT);

  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Events to score: ${n}` +
    (LIMIT !== Infinity ? ` (limit: ${LIMIT})` : "") + "\n"
  );

  // Cursor-based pagination so mutation (setting image_brightness_score) doesn't
  // cause OFFSET to skip rows mid-run.
  let lastId = "00000000-0000-0000-0000-000000000000";

  while (stats.processed < total) {
    const pageSize = Math.min(BATCH_SIZE, total - stats.processed);
    const { rows } = await pool.query(
      `SELECT id, name, image_url
         FROM public.events
        WHERE ${WHERE} AND id > $1
        ORDER BY id ASC
        LIMIT $2`,
      [lastId, pageSize]
    );
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map((e) =>
        processEvent(e).catch((err) => {
          stats.errors++;
          console.error(`  ! ERROR ${e.name}: ${err.message}`);
        })
      ));
      stats.processed += chunk.length;
    }
  }

  // ── Final report ───────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────────");
  console.log(`${DRY_RUN ? "DRY RUN " : ""}FINAL REPORT — Ticketmaster event images`);
  console.log("────────────────────────────────────────────");
  console.log(`Events processed           : ${stats.processed}`);
  console.log(`Successfully scored        : ${stats.scored}`);
  console.log(`Flagged score > ${TOO_BRIGHT_THRESHOLD} (too bright): ${stats.tooBright}`);
  console.log(`Skipped (fetch/decode fail): ${stats.skipped}`);
  console.log(`Errors                     : ${stats.errors}`);
  console.log(`\nBrightness score distribution:`);
  for (const [bucket, count] of Object.entries(stats.scoreDistribution)) {
    const bar = "█".repeat(Math.round(count / Math.max(stats.scored, 1) * 40));
    console.log(`  ${bucket.padEnd(7)}: ${String(count).padStart(5)}  ${bar}`);
  }
  console.log(
    `\nIn BannerBear: filter WHERE image_brightness_score > ${TOO_BRIGHT_THRESHOLD} ` +
    `to swap in a dark placeholder image.`
  );
}

run()
  .catch((err) => {
    console.error("FATAL:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
