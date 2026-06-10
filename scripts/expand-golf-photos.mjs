/**
 * Expand Google Places photos for active-package golf courses, then re-score
 * brightness across all slots to pick the best marketing image.
 *
 * Only targets courses with active packages whose events fall within the next
 * 30–180 days — the 12 courses that will actually appear in Instagram posts.
 *
 * Two phases per course:
 *   1. Photo expansion — fetch up to 10 photo names from Google Places API
 *      and resolve new URLs for slots image_url_4 through image_url_10.
 *      Slots already populated are skipped (re-runnable).
 *   2. Brightness re-score — download all populated slots at w400-h400-c,
 *      compute average greyscale brightness via sharp, and update
 *      marketing_image_url + image_brightness_score to the darkest winner
 *      from all available candidates (1–10).
 *
 * Google API: GOOGLE_PLACES_API_KEY (or GOOGLE_API_KEY) — same as backfill-golf-photos.mjs
 * DB: PG* env vars
 *
 * Usage:
 *   node --env-file=.env scripts/expand-golf-photos.mjs --dry-run
 *   node --env-file=.env scripts/expand-golf-photos.mjs
 */
import pg from "pg";
import sharp from "sharp";

// ── CLI flags ─────────────────────────────────────────────────────────────────
const DRY_RUN      = process.argv.includes("--dry-run");
const limitFlagIdx = process.argv.indexOf("--limit");
const LIMIT        = limitFlagIdx !== -1 ? Number(process.argv[limitFlagIdx + 1]) : Infinity;

// ── Config ────────────────────────────────────────────────────────────────────
const GOOGLE_KEY      = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY;
const MAX_PHOTOS      = 10;
const RATE_PER_SEC    = 10;
const MIN_INTERVAL_MS = 1000 / RATE_PER_SEC;
const FETCH_TIMEOUT_MS = 12_000;

if (!GOOGLE_KEY) {
  console.error("Missing GOOGLE_PLACES_API_KEY (or GOOGLE_API_KEY) in the environment.");
  process.exit(1);
}

// ── Photo slot definitions (column name → index into the photos array) ────────
const SLOTS = [
  { col: "image_url",    n: 1  },
  { col: "image_url_2",  n: 2  },
  { col: "image_url_3",  n: 3  },
  { col: "image_url_4",  n: 4  },
  { col: "image_url_5",  n: 5  },
  { col: "image_url_6",  n: 6  },
  { col: "image_url_7",  n: 7  },
  { col: "image_url_8",  n: 8  },
  { col: "image_url_9",  n: 9  },
  { col: "image_url_10", n: 10 },
];

// ── Rate limiter (verbatim from backfill-golf-photos.mjs) ─────────────────────
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now  = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot   = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

// ── Google Places helpers (verbatim from backfill-golf-photos.mjs) ─────────────
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

// ── Brightness scoring (from score-golf-images.mjs) ───────────────────────────
function smallUrl(url) {
  const eqIdx = url.lastIndexOf("=");
  if (eqIdx !== -1 && eqIdx > url.lastIndexOf("/")) {
    return url.slice(0, eqIdx) + "=w400-h400-c";
  }
  return url + "=w400-h400-c";
}

async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(smallUrl(url), { signal: controller.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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

// ── DB ────────────────────────────────────────────────────────────────────────
const client = new pg.Client({
  host:     process.env.PGHOST,
  port:     Number(process.env.PGPORT || 5432),
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  await client.connect();

  // Fetch the distinct active-package courses with all existing photo slots.
  const { rows: courses } = await client.query(`
    SELECT DISTINCT ON (gc.id)
      gc.id, gc.name, gc.source_id,
      gc.image_url,    gc.image_url_2,  gc.image_url_3,
      gc.image_url_4,  gc.image_url_5,  gc.image_url_6,
      gc.image_url_7,  gc.image_url_8,  gc.image_url_9,
      gc.image_url_10, gc.marketing_image_url
    FROM public.golf_courses gc
    JOIN public.packages     p  ON p.golf_course_id = gc.id
    JOIN public.events       e  ON e.id = p.event_id
    WHERE p.active = true
      AND e.active = true
      AND e.event_date BETWEEN CURRENT_DATE + INTERVAL '30 days'
                           AND CURRENT_DATE + INTERVAL '180 days'
    ORDER BY gc.id
  `);

  const limited = courses.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Active-package courses to process: ${limited.length}` +
    (LIMIT !== Infinity ? ` (limit: ${LIMIT} of ${courses.length})` : "") + "\n"
  );

  const stats = {
    processed: 0, newPhotos: 0, scored: 0,
    slotWins: Object.fromEntries(SLOTS.map((s) => [s.col, 0])),
    sameWinner: 0, betterFound: 0,
  };

  for (const course of limited) {
    console.log(`\n── ${course.name} ─────────────────────────────`);

    // ── Phase 1: fetch photo names, resolve missing slots ─────────────────────
    let photoNames = [];
    try {
      photoNames = await fetchPhotoNames(course.source_id);
    } catch (err) {
      console.error(`  ! fetchPhotoNames error: ${err.message}`);
    }
    console.log(`  Google Places returned ${photoNames.length} photo(s)`);

    const newUrls = {}; // col → url, for slots being filled this run
    for (let i = 0; i < photoNames.length; i++) {
      const slot = SLOTS[i];
      if (!slot) break;
      if (course[slot.col]) continue; // already stored — skip

      try {
        const uri = await resolvePhotoUri(photoNames[i]);
        if (uri) {
          newUrls[slot.col] = uri;
          stats.newPhotos++;
          console.log(`  + slot ${slot.n} resolved: ${uri.slice(0, 80)}…`);
        }
      } catch (err) {
        console.error(`  ! resolvePhotoUri slot ${slot.n}: ${err.message}`);
      }
    }

    // Merged view of all slots for scoring (existing + newly resolved)
    const allUrls = SLOTS.map((s) => ({
      col: s.col,
      n:   s.n,
      url: newUrls[s.col] ?? course[s.col] ?? null,
    })).filter((s) => s.url);

    console.log(`  Slots available for scoring: ${allUrls.length}`);

    // ── Phase 2: brightness scoring across all slots ───────────────────────────
    const scored = await Promise.all(
      allUrls.map(async ({ col, n, url }) => {
        const buf  = await fetchImage(url);
        if (!buf) return null;
        try {
          const score = await brightness(buf);
          return { col, n, url, score };
        } catch {
          return null;
        }
      })
    );

    const valid = scored.filter(Boolean);
    if (valid.length === 0) {
      console.log("  ! No slots could be scored — skipping update.");
      stats.processed++;
      continue;
    }

    const winner = valid.reduce((a, b) => (a.score <= b.score ? a : b));
    stats.scored++;
    stats.slotWins[winner.col] = (stats.slotWins[winner.col] ?? 0) + 1;

    const prevWinner = course.marketing_image_url;
    const improved   = prevWinner !== winner.url;
    if (improved) stats.betterFound++; else stats.sameWinner++;

    console.log(
      `  Scores: ${valid.map((s) => `slot${s.n}=${s.score.toFixed(1)}`).join("  ")}`
    );
    console.log(
      `  Winner: slot ${winner.n} (${winner.score.toFixed(1)})` +
      (improved ? "  ← NEW best" : "  (same as before)")
    );

    if (!DRY_RUN) {
      // Build dynamic SET for newly resolved slots + re-score results.
      const sets  = [];
      const vals  = [];
      let   pIdx  = 1;

      for (const [col, url] of Object.entries(newUrls)) {
        sets.push(`${col} = $${pIdx++}`);
        vals.push(url);
      }
      sets.push(`marketing_image_url    = $${pIdx++}`);  vals.push(winner.url);
      sets.push(`image_brightness_score = $${pIdx++}`);  vals.push(winner.score);
      sets.push(`updated_at             = now()`);
      vals.push(course.id);

      await client.query(
        `UPDATE public.golf_courses SET ${sets.join(", ")} WHERE id = $${pIdx}`,
        vals
      );
    }

    stats.processed++;
  }

  // ── Final report ───────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────────────");
  console.log(`${DRY_RUN ? "DRY RUN " : ""}FINAL REPORT — golf photo expansion`);
  console.log("────────────────────────────────────────────────");
  console.log(`Courses processed            : ${stats.processed}`);
  console.log(`New photo slots resolved     : ${stats.newPhotos}`);
  console.log(`Courses re-scored            : ${stats.scored}`);
  console.log(`  Better image found (slot 4–10 wins): ${stats.betterFound}`);
  console.log(`  Same winner as before               : ${stats.sameWinner}`);
  console.log(`\nWinning slot breakdown:`);
  for (const { col, n } of SLOTS) {
    const wins = stats.slotWins[col] ?? 0;
    if (wins > 0) console.log(`  slot ${String(n).padStart(2)} (${col.padEnd(12)}): ${wins}`);
  }
}

run()
  .catch((err) => {
    console.error("FATAL:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
