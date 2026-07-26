/**
 * Backfill discovery_shows for target golf-weekend audience artists via Ticketmaster.
 * Does NOT require weekend dates (unlike the scheduled refresh job).
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-discovery-artists.mjs --dry-run
 *   node --env-file=.env scripts/backfill-discovery-artists.mjs
 *   node --env-file=.env scripts/backfill-discovery-artists.mjs --artist "Eric Church"
 *   node --env-file=.env scripts/backfill-discovery-artists.mjs --from-hot
 *   node --env-file=.env scripts/backfill-discovery-artists.mjs --from-hot --missing-only
 */
import pg from "pg";
import { TARGET_AUDIENCE_ARTISTS } from "./audience-filters.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const FROM_HOT = process.argv.includes("--from-hot");
const MISSING_ONLY = process.argv.includes("--missing-only");
const artistFlagIdx = process.argv.indexOf("--artist");
const SINGLE_ARTIST = artistFlagIdx !== -1 ? process.argv[artistFlagIdx + 1] : null;

const TM_KEY =
  process.env.TM_API_KEY ||
  process.env.TICKETMASTER_CONSUMER_KEY ||
  process.env.TICKETMASTER_API_KEY;

if (!TM_KEY) {
  console.error("Missing TM_API_KEY (or TICKETMASTER_CONSUMER_KEY / TICKETMASTER_API_KEY).");
  process.exit(1);
}

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

const RATE_MS = 220;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + RATE_MS;
  if (wait) await sleep(wait);
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function addMonths(d, n) {
  const c = new Date(d);
  c.setUTCMonth(c.getUTCMonth() + n);
  return c;
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function artistMatches(eventArtist, query) {
  const a = normalize(eventArtist);
  const q = normalize(query);
  return a.includes(q) || q.includes(a);
}

function genreFromEvent(e) {
  return e.classifications?.[0]?.genre?.name ?? e.classifications?.[0]?.segment?.name ?? null;
}

function scoreEvent(e) {
  let score = 160;
  if (e.url) score += 10;
  if (e.images?.length) score += 15;
  if (e.priceRanges?.length) score += 10;
  const upcoming = e._embedded?.attractions?.[0]?.upcomingEvents?._total ?? 0;
  if (upcoming >= 50) score += 15;
  else if (upcoming >= 20) score += 10;
  return Math.min(score, 200);
}

function bestImage(e) {
  const imgs = e.images ?? [];
  const wide = imgs.filter((i) => (i.width ?? 0) >= 640).sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return wide[0]?.url ?? imgs[0]?.url ?? null;
}

async function tmSearchArtist(artist, startDate, endDate) {
  await throttle();
  const qs = new URLSearchParams({
    apikey: TM_KEY,
    countryCode: "US",
    classificationName: "Music",
    keyword: artist,
    size: "200",
    sort: "date,asc",
    startDateTime: `${startDate}T00:00:00Z`,
    endDateTime: `${endDate}T23:59:59Z`,
  });
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${qs}`);
  if (res.status === 429) {
    await sleep(1500);
    return tmSearchArtist(artist, startDate, endDate);
  }
  if (!res.ok) throw new Error(`TM ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const data = await res.json();
  return data._embedded?.events ?? [];
}

const METRO_MAP = {
  Landover: "Washington", "East Rutherford": "New York", Foxborough: "Boston",
  Inglewood: "Los Angeles", "Santa Clara": "San Jose", Sunrise: "Fort Lauderdale",
  Elmont: "New York", Uniondale: "New York", "Auburn Hills": "Detroit",
  "Commerce City": "Denver", Sandy: "Salt Lake City", Hillsboro: "Portland",
  Concord: "Charlotte", Bristow: "Washington", Noblesville: "Indianapolis",
  "Tinley Park": "Chicago", Rosemont: "Chicago", Waukegan: "Chicago",
  "Cuyahoga Falls": "Cleveland", Independence: "Cleveland", Mansfield: "Boston",
  Holmdel: "New York", Wantagh: "New York", "The Woodlands": "Houston",
  "Sugar Land": "Houston", Alpharetta: "Atlanta", Duluth: "Atlanta",
  "Chula Vista": "San Diego", Irvine: "Los Angeles", "Mountain View": "San Jose",
  Wheatland: "Sacramento", Clarkston: "Detroit", Burgettstown: "Pittsburgh",
  Hershey: "Harrisburg", Camden: "Philadelphia", Ridgefield: "Portland",
  George: "Seattle", "West Palm Beach": "Palm Beach", Morrison: "Denver",
  Highland: "Detroit", "West Valley City": "Salt Lake City", Saratoga: "Saratoga Springs",
  Solomons: "Washington", "New Lenox": "Chicago", Kent: "Seattle",
};

async function loadCityIndex() {
  const { rows: metros } = await pool.query(`
    SELECT slug, cities FROM public.metro_areas WHERE catalog_enabled = true
  `);
  const { rows: golfCities } = await pool.query(`
    SELECT DISTINCT LOWER(city) AS city FROM public.golf_courses
    WHERE active = true AND marketing_image_url IS NOT NULL
  `);
  const golfSet = new Set(golfCities.map((r) => r.city));

  const resolve = new Map();
  for (const row of metros) {
    const cities = Array.isArray(row.cities) ? row.cities : [];
    for (const c of cities) {
      resolve.set(c.toLowerCase(), { slug: row.slug, lookupCity: c });
    }
  }
  for (const [suburb, metroCity] of Object.entries(METRO_MAP)) {
    const key = suburb.toLowerCase();
    if (!resolve.has(key)) {
      const hit = [...resolve.entries()].find(([k]) => k === metroCity.toLowerCase());
      if (hit) resolve.set(key, hit[1]);
    }
  }
  return { resolve, golfSet };
}

function lookupShowCity(rawCity, index) {
  const key = (rawCity || "").toLowerCase();
  if (index.resolve.has(key)) return index.resolve.get(key);
  if (index.golfSet.has(key)) {
    return { slug: key.replace(/\s+/g, "-"), lookupCity: rawCity };
  }
  const mapped = METRO_MAP[rawCity];
  if (mapped) {
    const mk = mapped.toLowerCase();
    if (index.resolve.has(mk)) return index.resolve.get(mk);
    if (index.golfSet.has(mk)) return { slug: mk.replace(/\s+/g, "-"), lookupCity: mapped };
  }
  return null;
}

async function loadHotArtistNames({ missingOnly = false } = {}) {
  if (missingOnly) {
    const { rows } = await pool.query(`
      SELECT ha.artist_name
      FROM public.hot_artists ha
      WHERE ha.active = true
        AND NOT EXISTS (
          SELECT 1 FROM public.discovery_shows ds
          WHERE ds.active = true
            AND ds.event_date >= CURRENT_DATE + INTERVAL '14 days'
            AND ds.event_date <= CURRENT_DATE + INTERVAL '270 days'
            AND (
              ha.artist_key = regexp_replace(lower(trim(ds.artist)), '[^a-z0-9]+', ' ', 'g')
              OR lower(trim(ds.artist)) = lower(trim(ha.artist_name))
              OR lower(ds.artist) LIKE '%' || lower(ha.artist_name) || '%'
            )
        )
      ORDER BY ha.heat_score DESC
      LIMIT 40
    `);
    return rows.map((r) => r.artist_name).filter(Boolean);
  }
  const { rows } = await pool.query(`
    SELECT artist_name
    FROM public.hot_artists
    WHERE active = true
    ORDER BY heat_score DESC
    LIMIT 40
  `);
  return rows.map((r) => r.artist_name).filter(Boolean);
}

async function main() {
  const today = new Date();
  const startDate = ymd(today);
  const endDate = ymd(addMonths(today, 6));
  const cityToMetro = await loadCityIndex();
  let artists;
  if (SINGLE_ARTIST) {
    artists = [SINGLE_ARTIST];
  } else if (FROM_HOT) {
    artists = await loadHotArtistNames({ missingOnly: MISSING_ONLY });
    if (!artists.length) {
      console.log("No hot artists to backfill.");
      await pool.end();
      return;
    }
  } else {
    artists = TARGET_AUDIENCE_ARTISTS;
  }

  console.log(
    `${DRY_RUN ? "[DRY RUN] " : ""}Backfilling ${artists.length} artists` +
      `${FROM_HOT ? " (from hot_artists)" : ""} (${startDate} → ${endDate})\n`,
  );

  const rows = [];
  for (const artist of artists) {
    let events;
    try {
      events = await tmSearchArtist(artist, startDate, endDate);
    } catch (err) {
      console.log(`✗ ${artist}: ${err.message}`);
      continue;
    }

    let matched = 0;
    for (const e of events) {
      const id = e.id?.trim();
      const date = e.dates?.start?.localDate;
      const venue = e._embedded?.venues?.[0];
      const city = venue?.city?.name ?? "";
      const eventArtist = e._embedded?.attractions?.[0]?.name ?? e.name ?? "";
      if (!id || !date || !city) continue;
      if (!artistMatches(eventArtist, artist)) continue;

      const metro = lookupShowCity(city, cityToMetro);
      if (!metro) continue;

      matched++;
      rows.push({
        tm_event_id: id,
        artist: eventArtist,
        event_name: e.name ?? eventArtist,
        metro_slug: metro.slug,
        city: metro.lookupCity,
        venue: venue?.name ?? null,
        event_date: date,
        genre: genreFromEvent(e),
        ticket_url: e.url ?? null,
        image_url: bestImage(e),
        min_price: e.priceRanges?.[0]?.min ?? null,
        max_price: e.priceRanges?.[0]?.max ?? null,
        score: scoreEvent(e),
        active: true,
      });
    }
    console.log(`• ${artist}: ${events.length} TM hits → ${matched} in catalog metros`);
  }

  if (!rows.length) {
    console.log("\nNo rows to upsert.");
    await pool.end();
    return;
  }

  const runIso = new Date().toISOString();
  if (DRY_RUN) {
    console.log(`\nWould upsert ${rows.length} shows:`);
    for (const r of rows.slice(0, 20)) {
      console.log(`  ${r.artist} | ${r.event_date} | ${r.city} | score=${r.score} | ${r.genre ?? "?"}`);
    }
    if (rows.length > 20) console.log(`  … and ${rows.length - 20} more`);
    await pool.end();
    return;
  }

  let upserted = 0;
  for (const r of rows) {
    await pool.query(
      `INSERT INTO public.discovery_shows
        (tm_event_id, artist, event_name, metro_slug, city, venue, event_date, genre,
         ticket_url, image_url, min_price, max_price, score, active, refreshed_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$14)
       ON CONFLICT (tm_event_id) DO UPDATE SET
         artist = EXCLUDED.artist,
         event_name = EXCLUDED.event_name,
         metro_slug = EXCLUDED.metro_slug,
         city = EXCLUDED.city,
         venue = EXCLUDED.venue,
         event_date = EXCLUDED.event_date,
         genre = EXCLUDED.genre,
         ticket_url = EXCLUDED.ticket_url,
         image_url = COALESCE(EXCLUDED.image_url, discovery_shows.image_url),
         min_price = EXCLUDED.min_price,
         max_price = EXCLUDED.max_price,
         score = GREATEST(discovery_shows.score, EXCLUDED.score),
         active = true,
         refreshed_at = EXCLUDED.refreshed_at,
         updated_at = EXCLUDED.updated_at`,
      [
        r.tm_event_id, r.artist, r.event_name, r.metro_slug, r.city, r.venue,
        r.event_date, r.genre, r.ticket_url, r.image_url, r.min_price, r.max_price,
        r.score, runIso,
      ]
    );
    upserted++;
  }

  console.log(`\n✓ Upserted ${upserted} discovery_shows rows.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
