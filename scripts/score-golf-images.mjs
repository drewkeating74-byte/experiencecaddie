/**
 * Score golf-course images by brightness and pick the darkest for marketing use.
 *
 * For each google_places course with at least one image URL:
 *   1. Fetches up to three images at w400-h400-c crop (fast, small payload).
 *   2. Computes average pixel brightness via sharp (0 = black, 100 = white).
 *   3. Picks the darkest image as marketing_image_url.
 *   4. Writes image_brightness_score (of the winner) + marketing_image_url back
 *      to golf_courses — skips rows that already have marketing_image_url set.
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
 *   node --env-file=.env scripts/score-golf-images.mjs --dry-run --limit 5
 *   node --env-file=.env scripts/score-golf-images.mjs
 */
import pg from "pg";
import sharp from "sharp";

// ── CLI flags ─────────────────────────────────────────────────────────────────
const DRY_RUN   = process.argv.includes("--dry-run");
const limitIdx  = process.argv.indexOf("--limit");
const LIMIT     = limitIdx !== -1 ? Number(process.argv[limitIdx + 1]) : Infinity;

// ── Config ────────────────────────────────────────────────────────────────────
const BATCH_SIZE   = 50;
const CONCURRENCY  = 6;    // parallel image fetches per batch
const FETCH_SUFFIX = "=w400-h400-c"; // appended to Google Places URLs for fast crops
const FETCH_TIMEOUT_MS = 12_000;

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

/** Convert a Google Places photo URL to the w400-h400-c crop variant. */
function smallUrl(url) {
  // Google Photos URLs end with =w<W>-h<H>[-k-no|-c|...]
  // Replace everything after the last '=' with the desired size params.
  const eqIdx = url.lastIndexOf("=");
  if (eqIdx !== -1 && eqIdx > url.lastIndexOf("/")) {
    return url.slice(0, eqIdx) + FETCH_SUFFIX;
  }
  // Fallback: try appending directly (works for some CDNs)
  return url + FETCH_SUFFIX;
}

/** Fetch an image with timeout; returns null on any error. */
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

/**
 * Compute average pixel brightness as a 0–100 float.
 * Converts to greyscale and averages all pixel values.
 */
async function brightness(buf) {
  const { data, info } = await sharp(buf)
    .resize(80, 80, { fit: "inside" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return Math.round((sum / data.length / 255) * 100 * 10) / 10; // one decimal
}

/** Score a single URL; returns { score, url } or null if fetch/parse fails. */
async function scoreUrl(rawUrl) {
  const url = smallUrl(rawUrl);
  const buf = await fetchImage(url);
  if (!buf) return null;
  try {
    const score = await brightness(buf);
    return { score, url: rawUrl }; // store original URL, not the resized one
  } catch {
    return null;
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────
const stats = {
  processed: 0,
  scored: 0,
  skipped: 0,       // fetch/decode failures
  img1Wins: 0,
  img2Wins: 0,
  img3Wins: 0,
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

// ── Core per-course logic ─────────────────────────────────────────────────────
async function processCourse(course) {
  const candidates = [
    course.image_url   ? { slot: 1, url: course.image_url   } : null,
    course.image_url_2 ? { slot: 2, url: course.image_url_2 } : null,
    course.image_url_3 ? { slot: 3, url: course.image_url_3 } : null,
  ].filter(Boolean);

  const results = await Promise.all(candidates.map(({ slot, url }) =>
    scoreUrl(url).then((r) => r ? { slot, url, score: r.score } : null)
  ));

  const valid = results.filter(Boolean);
  if (valid.length === 0) {
    stats.skipped++;
    return;
  }

  // Darkest = lowest score
  const winner = valid.reduce((a, b) => (a.score <= b.score ? a : b));

  stats.scored++;
  stats.scoreDistribution[bucketScore(winner.score)]++;
  if (winner.slot === 1) stats.img1Wins++;
  else if (winner.slot === 2) stats.img2Wins++;
  else stats.img3Wins++;

  if (DRY_RUN) {
    console.log(
      `• ${course.name.padEnd(40)} ` +
      valid.map((r) => `img${r.slot}=${r.score.toFixed(1)}`).join("  ") +
      `  → winner: img${winner.slot} (${winner.score.toFixed(1)})`
    );
    return;
  }

  await pool.query(
    `UPDATE public.golf_courses
        SET image_brightness_score = $1,
            marketing_image_url    = $2,
            updated_at             = now()
      WHERE id = $3`,
    [winner.score, winner.url, course.id]
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  // Pool connects lazily — no explicit connect() needed.

  // Dry-run skips the IS NULL guard so it works before the migration is applied.
  const WHERE = DRY_RUN
    ? `source = 'google_places' AND image_url IS NOT NULL AND image_url <> ''`
    : `source = 'google_places' AND image_url IS NOT NULL AND image_url <> ''
         AND marketing_image_url IS NULL`;

  const { rows: [{ n }] } = await pool.query(
    `SELECT count(*)::int AS n FROM public.golf_courses WHERE ${WHERE}`
  );
  const total = Math.min(n, LIMIT);

  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Courses to score: ${n}` +
    (LIMIT !== Infinity ? ` (limit: ${LIMIT})` : "") + "\n"
  );

  // Cursor-based pagination so mutation (setting marketing_image_url) doesn't
  // cause OFFSET to skip rows mid-run.
  let lastId = "00000000-0000-0000-0000-000000000000";

  while (stats.processed < total) {
    const pageSize = Math.min(BATCH_SIZE, total - stats.processed);
    const { rows } = await pool.query(
      `SELECT id, name, image_url, image_url_2, image_url_3
         FROM public.golf_courses
        WHERE ${WHERE} AND id > $1
        ORDER BY id ASC
        LIMIT $2`,
      [lastId, pageSize]
    );
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map((c) =>
        processCourse(c).catch((err) => {
          stats.errors++;
          console.error(`  ! ERROR ${c.name}: ${err.message}`);
        })
      ));
      stats.processed += chunk.length;
    }

    if (stats.processed % 200 === 0 || stats.processed >= total) {
      console.log(`Progress: ${stats.processed}/${total} | scored: ${stats.scored} | skipped: ${stats.skipped}`);
    }
  }

  // ── Final report ───────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────────");
  console.log(`${DRY_RUN ? "DRY RUN " : ""}FINAL REPORT — golf course images`);
  console.log("────────────────────────────────────────────");
  console.log(`Courses processed          : ${stats.processed}`);
  console.log(`Successfully scored        : ${stats.scored}`);
  console.log(`Skipped (fetch/decode fail): ${stats.skipped}`);
  console.log(`Errors                     : ${stats.errors}`);
  console.log(`\nWinning image slot:`);
  console.log(`  image_url  (slot 1) wins : ${stats.img1Wins}`);
  console.log(`  image_url_2 (slot 2) wins: ${stats.img2Wins}`);
  console.log(`  image_url_3 (slot 3) wins: ${stats.img3Wins}`);
  console.log(`\nBrightness score distribution (winning image):`);
  for (const [bucket, count] of Object.entries(stats.scoreDistribution)) {
    const bar = "█".repeat(Math.round(count / Math.max(stats.scored, 1) * 40));
    console.log(`  ${bucket.padEnd(7)}: ${String(count).padStart(5)}  ${bar}`);
  }
}

run()
  .catch((err) => {
    console.error("FATAL:", err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
