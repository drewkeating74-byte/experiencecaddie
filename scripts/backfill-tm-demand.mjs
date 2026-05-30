/**
 * Backfill a Ticketmaster-derived demand score into public.artists.
 *
 * Spotify popularity is unavailable to our API app, so "top artists / high
 * demand" is proxied from Ticketmaster signals for each artist:
 *   - tour breadth: number of upcoming US events (page.totalElements)
 *   - venue size tier: largest venue across their upcoming events
 *   - ticket price: max price range seen
 * These combine into ticketmaster_demand_score (0-100) on every artist row
 * that shares the name. Also stamps demand_synced_at.
 *
 * Key: TM_API_KEY (falls back to TICKETMASTER_CONSUMER_KEY / TICKETMASTER_API_KEY).
 * DB access via direct Postgres (PG* env vars), same as the other backfills.
 *
 * Re-runnable: by default only scores artists where ticketmaster_demand_score
 * IS NULL. Pass --refresh to re-score everyone (demand changes as tours are
 * announced / sell through).
 *
 * NOTE: Ticketmaster's ToS prohibits *scheduled/automated* calls. This is an
 * operator-triggered, one-off backfill (consistent with the seed/photo scripts).
 *
 * Usage:
 *   node scripts/backfill-tm-demand.mjs --dry-run --limit 5
 *   node scripts/backfill-tm-demand.mjs
 *   node scripts/backfill-tm-demand.mjs --refresh
 */
import pg from "pg";

const DRY_RUN = process.argv.includes("--dry-run");
const REFRESH = process.argv.includes("--refresh");
const limitFlagIdx = process.argv.indexOf("--limit");
const LIMIT = limitFlagIdx !== -1 ? Number(process.argv[limitFlagIdx + 1]) : Infinity;

const TM_KEY =
  process.env.TM_API_KEY ||
  process.env.TICKETMASTER_CONSUMER_KEY ||
  process.env.TICKETMASTER_API_KEY;

const RATE_PER_SEC = 5;
const MIN_INTERVAL_MS = 1000 / RATE_PER_SEC;

if (!TM_KEY) {
  console.error("Missing TM_API_KEY (or TICKETMASTER_CONSUMER_KEY / TICKETMASTER_API_KEY).");
  process.exit(1);
}

const NAME_WHERE = REFRESH
  ? `name IS NOT NULL AND trim(name) <> ''`
  : `name IS NOT NULL AND trim(name) <> '' AND ticketmaster_demand_score IS NULL`;

// ── Rate limiter (<= 5 req/s) ─────────────────────────────────────────────────
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

async function tmGet(path, params) {
  await throttle();
  const qs = new URLSearchParams({ ...params, apikey: TM_KEY }).toString();
  const url = `https://app.ticketmaster.com/discovery/v2/${path}?${qs}`;
  const res = await fetch(url);
  if (res.status === 429) {
    await sleep(1500);
    return tmGet(path, params);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TM ${res.status}: ${body.slice(0, 160)}`);
  }
  return res.json();
}

// ── Demand signal scoring ─────────────────────────────────────────────────────
function venueTierPoints(venueName) {
  const n = (venueName || "").toLowerCase();
  if (/stadium|field|ballpark/.test(n)) return 30;
  if (/arena|center|centre|garden|forum|sphere|coliseum|colosseum/.test(n)) return 22;
  if (/amphitheat(er|re)|pavilion|outdoor|lawn/.test(n)) return 14;
  if (/theat(er|re)|hall|auditorium|opera|music center/.test(n)) return 8;
  return 4;
}

function pricePoints(maxPrice) {
  if (maxPrice == null) return 0;
  if (maxPrice >= 400) return 20;
  if (maxPrice >= 250) return 15;
  if (maxPrice >= 150) return 10;
  if (maxPrice >= 75) return 5;
  return 2;
}

// dates: 1 pt per upcoming US event, capped at 50.
function datesPoints(totalUpcoming) {
  return Math.min(Math.max(totalUpcoming, 0), 50);
}

/** Resolve the best matching music attraction id for an artist name. */
async function resolveAttractionId(name) {
  const data = await tmGet("attractions.json", {
    keyword: name,
    size: "10",
    sort: "relevance,desc",
  });
  const items = data?._embedded?.attractions ?? [];
  if (items.length === 0) return null;
  const norm = (s) => (s || "").trim().toLowerCase();
  const isMusic = (a) =>
    (a.classifications ?? []).some((c) => /music/i.test(c?.segment?.name ?? ""));
  const exactMusic = items.find((a) => norm(a.name) === norm(name) && isMusic(a));
  const exact = items.find((a) => norm(a.name) === norm(name));
  const music = items.find(isMusic);
  const best = exactMusic || exact || music || items[0];
  return best?.id ?? null;
}

/** Gather demand signals from an attraction's upcoming US events. */
async function gatherSignals(attractionId) {
  const nowIso = new Date().toISOString().slice(0, 19) + "Z";
  const data = await tmGet("events.json", {
    attractionId,
    countryCode: "US",
    size: "100",
    sort: "date,asc",
    startDateTime: nowIso,
  });
  const totalUpcoming = data?.page?.totalElements ?? 0;
  const events = data?._embedded?.events ?? [];
  let maxVenuePts = 4;
  let maxPrice = null;
  for (const ev of events) {
    const venueName = ev?._embedded?.venues?.[0]?.name;
    maxVenuePts = Math.max(maxVenuePts, venueTierPoints(venueName));
    for (const pr of ev?.priceRanges ?? []) {
      const m = Number(pr?.max);
      if (Number.isFinite(m)) maxPrice = Math.max(maxPrice ?? 0, m);
    }
  }
  return { totalUpcoming, maxVenuePts, maxPrice };
}

function computeScore({ totalUpcoming, maxVenuePts, maxPrice }) {
  const raw = datesPoints(totalUpcoming) + maxVenuePts + pricePoints(maxPrice);
  return Math.max(0, Math.min(100, Math.round(raw)));
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

const stats = { processed: 0, scored: 0, noAttraction: 0, rowsUpdated: 0, errors: 0 };
const errorSamples = [];
const noMatchSamples = [];

function logProgress(total) {
  console.log(
    `Progress: ${stats.processed}/${total} | Scored: ${stats.scored} | ` +
    `No attraction: ${stats.noAttraction} | Rows updated: ${stats.rowsUpdated} | Errors: ${stats.errors}`
  );
}

async function run() {
  await client.connect();

  const { rows: nameRows } = await client.query(
    `SELECT DISTINCT name FROM public.artists WHERE ${NAME_WHERE} ORDER BY name;`
  );
  const total = Math.min(nameRows.length, LIMIT);
  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Distinct artist names to score: ${nameRows.length}` +
    `${LIMIT !== Infinity ? ` (processing first ${total})` : ""}` +
    `${REFRESH ? " [--refresh: all]" : " [unscored only]"}\n`
  );

  for (let i = 0; i < total; i++) {
    const name = nameRows[i].name;
    try {
      const attractionId = await resolveAttractionId(name);
      if (!attractionId) {
        stats.noAttraction++;
        if (noMatchSamples.length < 30) noMatchSamples.push(name);
        if (DRY_RUN) console.log(`\n• ${name}\n   no Ticketmaster attraction match -> score NULL`);
      } else {
        const signals = await gatherSignals(attractionId);
        const score = computeScore(signals);
        stats.scored++;
        if (DRY_RUN) {
          console.log(
            `\n• ${name} (attraction ${attractionId})\n` +
            `   upcoming US events: ${signals.totalUpcoming} | ` +
            `venue pts: ${signals.maxVenuePts} | max price: ${signals.maxPrice ?? "n/a"}\n` +
            `   => demand score: ${score}`
          );
        } else {
          const r = await client.query(
            `UPDATE public.artists
                SET ticketmaster_demand_score = $1,
                    demand_synced_at = now(),
                    updated_at = now()
              WHERE name = $2;`,
            [score, name]
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
  console.log(`Scored                : ${stats.scored}`);
  console.log(`No attraction match   : ${stats.noAttraction}`);
  console.log(`Artist rows updated   : ${stats.rowsUpdated}`);
  console.log(`Errors                : ${stats.errors}`);
  if (noMatchSamples.length) {
    console.log(`\nNo-attraction names (up to 30):`);
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
