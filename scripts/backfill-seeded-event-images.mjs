/**
 * Backfill images for SEEDED concert events that aren't sourced from a
 * Ticketmaster event id (source_name <> 'ticketmaster'). These are demo/curated
 * rows for well-known artists, so we can't look up a specific TM event — instead
 * we resolve the artist's official image via the TM Discovery *attractions*
 * (search-by-name) endpoint and apply it to both events.image_url and
 * artists.image_url.
 *
 * Strict-ish matching: prefer an attraction whose name equals/﻿contains the
 * artist name; never fall back to an unrelated top result.
 *
 * DB: PG* env vars. Key: TM_API_KEY / TICKETMASTER_CONSUMER_KEY / TICKETMASTER_API_KEY.
 *
 *   node scripts/backfill-seeded-event-images.mjs --dry-run
 *   node scripts/backfill-seeded-event-images.mjs
 */
import pg from "pg";

const DRY = process.argv.includes("--dry-run");
const TM_KEY =
  process.env.TM_API_KEY ||
  process.env.TICKETMASTER_CONSUMER_KEY ||
  process.env.TICKETMASTER_API_KEY;

const RATE_PER_SEC = 5;
const MIN_INTERVAL_MS = 1000 / RATE_PER_SEC;

let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

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

async function findAttractionImage(artist) {
  await throttle();
  const url = new URL("https://app.ticketmaster.com/discovery/v2/attractions.json");
  url.searchParams.set("apikey", TM_KEY);
  url.searchParams.set("keyword", artist);
  url.searchParams.set("size", "10");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TM attractions ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const attractions = data?._embedded?.attractions ?? [];
  const want = artist.trim().toLowerCase();
  const match =
    attractions.find((a) => (a.name ?? "").trim().toLowerCase() === want) ||
    attractions.find((a) => {
      const n = (a.name ?? "").trim().toLowerCase();
      return n && (n.includes(want) || want.includes(n));
    });
  return match ? pickBestImage(match.images) : null;
}

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

const stats = { processed: 0, eventsUpdated: 0, noMatch: 0, artistsUpdated: 0, errors: 0 };
const errorSamples = [];

async function run() {
  if (!TM_KEY) throw new Error("Missing Ticketmaster API key env var.");
  await client.connect();

  const { rows } = await client.query(`
    SELECT e.id, e.name, e.artist_id, a.name AS artist
    FROM public.events e
    LEFT JOIN public.artists a ON a.id = e.artist_id
    WHERE e.event_date >= current_date
      AND e.image_url IS NULL
      AND e.source_name IS DISTINCT FROM 'ticketmaster'
    ORDER BY e.event_date;
  `);

  console.log(`${DRY ? "[DRY RUN] " : ""}Seeded events missing images: ${rows.length}\n`);

  for (const ev of rows) {
    const artist = (ev.artist ?? "").trim();
    try {
      const img = artist ? await findAttractionImage(artist) : null;
      if (!img) {
        stats.noMatch++;
        console.log(`• ${ev.name} — artist="${artist || "?"}" → NO TM attraction image`);
      } else {
        stats.eventsUpdated++;
        console.log(`• ${ev.name} — artist="${artist}" → ${img}`);
        if (!DRY) {
          await client.query(
            `UPDATE public.events SET image_url = $1, updated_at = now() WHERE id = $2;`,
            [img, ev.id]
          );
          if (ev.artist_id) {
            const r = await client.query(
              `UPDATE public.artists SET image_url = COALESCE(image_url, $1), updated_at = now()
                WHERE id = $2 AND image_url IS NULL;`,
              [img, ev.artist_id]
            );
            if (r.rowCount > 0) stats.artistsUpdated++;
          }
        }
      }
    } catch (err) {
      stats.errors++;
      const msg = `${ev.name} (${artist}): ${err.message}`;
      if (errorSamples.length < 20) errorSamples.push(msg);
      console.error(`  ! ERROR ${msg}`);
    }
    stats.processed++;
  }

  console.log("\n────────────────────────────────────────");
  console.log(`${DRY ? "DRY RUN " : ""}FINAL REPORT`);
  console.log("────────────────────────────────────────");
  console.log(`Events processed       : ${stats.processed}`);
  console.log(`Events image resolved  : ${stats.eventsUpdated}`);
  console.log(`No TM attraction match : ${stats.noMatch}`);
  console.log(`Artists updated        : ${stats.artistsUpdated}`);
  console.log(`Errors                 : ${stats.errors}`);
  if (errorSamples.length) {
    console.log(`\nError samples:`);
    errorSamples.forEach((e) => console.log(`  - ${e}`));
  }
}

run()
  .catch((err) => {
    console.error("FATAL:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
