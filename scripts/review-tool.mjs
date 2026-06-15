/**
 * Experience Caddie — Instagram Post Review Tool
 *
 * Local web server for selecting images and approving Instagram carousel posts.
 * Runs twice a week; no framework, no build step.
 *
 * Usage:
 *   node --env-file=.env scripts/review-tool.mjs
 *
 * Then open http://localhost:3000 (printed on start; auto-opens on Mac/Linux).
 *
 * Endpoints:
 *   GET  /              → Review UI (HTML)
 *   GET  /api/packages  → Next 2 eligible packages with all image slots
 *   POST /api/generate  → Call BannerBear Collections API, return slide URLs
 *   POST /api/approve   → Insert into instagram_queue (status = pending)
 *   POST /api/skip      → Insert into instagram_queue (status = skipped)
 *
 * Required env vars:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   BANNERBEAR_API_KEY   (optional — generate button disabled if missing)
 */
import http from "http";
import { exec } from "child_process";
import pg from "pg";
import sharp from "sharp";
import {
  audienceGenreSql,
  audienceScoreSql,
  FEATURED_CITIES,
} from "./audience-filters.mjs";

const PORT = 3000;
const BB_KEY        = process.env.BANNERBEAR_API_KEY;
const BB_TEMPLATE   = "8D6okAWQ2BNrnNmXPl"; // Collection template set UID
const SUPABASE_URL  = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUFFER_TOKEN  = process.env.BUFFER_ACCESS_TOKEN;
const BUFFER_CHAN   = process.env.BUFFER_CHANNEL_ID;
const BUFFER_GQL    = "https://api.buffer.com";

// Posting schedule: [dayOfWeek (0=Sun), hour, minute] in Central time (UTC-5/UTC-6)
// Mon 12pm CT = 17:00 UTC (CDT) | Wed 12pm CT = 17:00 UTC | Sat 9am CT = 14:00 UTC
const POST_SLOTS = [
  { day: 1, hour: 17, minute: 0 },  // Monday    noon Central (UTC-5)
  { day: 3, hour: 17, minute: 0 },  // Wednesday noon Central
  { day: 6, hour: 14, minute: 0 },  // Saturday  9am  Central
];

/** Returns the next available UTC posting time from POST_SLOTS, at least 1 hour from now. */
function nextPostSlot() {
  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 60 * 1000); // at least 1h from now
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    for (const slot of POST_SLOTS) {
      const candidate = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead,
        slot.hour, slot.minute, 0, 0
      ));
      if (candidate.getUTCDay() === slot.day && candidate > soon) return candidate;
    }
  }
  // Fallback: 4 hours from now
  return new Date(now.getTime() + 4 * 60 * 60 * 1000);
}

/** Schedule a carousel post in Buffer and return the Buffer post ID. */
async function scheduleInBuffer({ slides, caption, scheduledAt }) {
  if (!BUFFER_TOKEN || !BUFFER_CHAN) return null;
  const assets = slides.map(url => ({ image: { url } }));
  const res = await fetch(BUFFER_GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${BUFFER_TOKEN}` },
    body: JSON.stringify({
      query: `mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess { post { id } }
          ... on MutationError { message }
        }
      }`,
      variables: {
        input: {
          channelId:     BUFFER_CHAN,
          text:          caption,
          assets,
          schedulingType: "automatic",
          dueAt:         scheduledAt.toISOString(),
          mode:          "customScheduled",
          metadata: { instagram: { type: "post", shouldShareToFeed: true } },
        },
      },
    }),
  });
  const data = await res.json();
  const post = data?.data?.createPost?.post;
  const err  = data?.data?.createPost?.message;
  if (err) throw new Error(`Buffer: ${err}`);
  return post?.id ?? null;
}

function buildCaption({ artistName, courseCourseName, city, eventDateFmt }) {
  const artist = artistName    || "";
  const course = courseCourseName || "";
  return [
    `🎸⛳ ${artist} + a round of golf in ${city}`,
    ``,
    `${artist} is playing ${city} on ${eventDateFmt}. Make a weekend of it — tee off at ${course} and catch the show that night.`,
    ``,
    `🔗 Build your package at experiencecaddie.com`,
    ``,
    `#golf #concert #golfweekend #${artist.toLowerCase().replace(/[^a-z0-9]/g, "")} #experiencecaddie #guysweekend #golftrip`,
  ].join("\n");
}

// ── Hook copy bank ────────────────────────────────────────────────────────────
// Rotate copy so repeat viewers see different openers. Selection is
// deterministic per package_id so the same package always gets the same hook.

const HOOK_VARIANTS = [
  {
    hook_label:     "GOLF + CONCERT WEEKEND",
    hook_headline:  "Golf. A concert.\nOne overdue weekend.",
    hook_subhead:   "Send this to the group chat.",
    hook_pill_text: "Build it in minutes",
  },
  {
    hook_label:     "GUYS' WEEKEND IDEA",
    hook_headline:  "The group chat\nneeds a plan.",
    hook_subhead:   "Pick the show. Add the tee time.",
    hook_pill_text: "Build the weekend",
  },
  {
    hook_label:     "GOLF + LIVE MUSIC",
    hook_headline:  "You keep saying you'll\nget the guys together.",
    hook_subhead:   "Start with a show and a round.",
    hook_pill_text: "Send it to the group",
  },
  {
    hook_label:     "OVERDUE WEEKEND",
    hook_headline:  "Life got busy.\nThe trip doesn't have to.",
    hook_subhead:   "Golf, live music, and a real plan.",
    hook_pill_text: "Start planning",
  },
  {
    hook_label:     "GROUP CHAT FUEL",
    hook_headline:  "Before everyone says\n\"sometime\" again…",
    hook_subhead:   "Build the golf + concert weekend now.",
    hook_pill_text: "Make it happen",
  },
  {
    hook_label:     "GOLF + CONCERT WEEKEND",
    hook_headline:  "Pick the show.\nWe'll build the golf weekend.",
    hook_subhead:   "Concert, course, hotel — planned in minutes.",
    hook_pill_text: "Build my weekend",
  },
  {
    hook_label:     "WEEKEND TRIP IDEA",
    hook_headline:  "One concert.\nOne tee time.",
    hook_subhead:   "Zero planning spiral.",
    hook_pill_text: "See the plan",
  },
  {
    hook_label:     "ANNUAL TRIP ENERGY",
    hook_headline:  "The annual guys' trip\njust found its plan.",
    hook_subhead:   "Golf by day. Live music by night.",
    hook_pill_text: "Build the trip",
  },
  {
    hook_label:     "SEND THIS TO THE GROUP CHAT",
    hook_headline:  "This is the excuse.",
    hook_subhead:   "Golf, a live show, and one weekend worth making happen.",
    hook_pill_text: "Build it now",
  },
  {
    hook_label:     "GOLF + LIVE SHOW",
    hook_headline:  "You already have\nthe friends.",
    hook_subhead:   "We'll help build the weekend.",
    hook_pill_text: "Plan it in minutes",
  },
];

const HOOK_DEFAULTS = HOOK_VARIANTS[0];

// Consistent per package_id, varies across packages.
function pickHookVariant(packageId = "") {
  const hash = [...String(packageId)].reduce((h, c) => ((h * 31) + c.charCodeAt(0)) >>> 0, 0);
  return HOOK_VARIANTS[hash % HOOK_VARIANTS.length];
}

// Validate char limits and uppercase label; fall back to defaults per field.
function normalizeHook(hook) {
  const label    = String(hook.hook_label    || "").toUpperCase().slice(0, 28)    || HOOK_DEFAULTS.hook_label;
  const headline = String(hook.hook_headline || "");
  const subhead  = String(hook.hook_subhead  || "").slice(0, 75)                  || HOOK_DEFAULTS.hook_subhead;
  const pillText = String(hook.hook_pill_text|| "").slice(0, 24)                  || HOOK_DEFAULTS.hook_pill_text;
  // headline: 35–55 chars (excluding \n). If too long fall back to default.
  const headlineClean = headline.replace(/\\n/g, "\n");
  const headlineLen   = headlineClean.replace(/\n/g, "").length;
  return {
    hook_label:     label,
    hook_headline:  headlineLen > 0 && headlineLen <= 55 ? headlineClean : HOOK_DEFAULTS.hook_headline.replace(/\\n/g, "\n"),
    hook_subhead:   subhead,
    hook_pill_text: pillText,
  };
}

// ── DB pool ───────────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  host:     process.env.PGHOST,
  port:     Number(process.env.PGPORT || 5432),
  user:     process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

// ── Supabase REST helper (for instagram_queue writes — bypasses RLS) ───────────
async function supabaseInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`Supabase insert failed: ${await res.text()}`);
  return res.json();
}

// ── Package query ─────────────────────────────────────────────────────────────
async function fetchPackages(limit = 50, sort = "date_asc", city = "") {
  const order = sort === "date_desc" ? "DESC" : "ASC";
  const params = [limit];
  let cityClause = "";
  if (city) {
    params.push(city);
    cityClause = `AND LOWER(gc.city) = LOWER($${params.length})`;
  }
  // Exclude packages already in the queue (pending or posted)
  const { rows } = await pool.query(`
    SELECT
      p.id, p.name AS package_name, p.city,
      a.name                      AS artist_name,
      gc.name                     AS course_name,
      gc.state                    AS course_state,
      gc.rating                   AS course_rating,
      to_char(e.event_date, 'Mon DD, YYYY') AS event_date_fmt,
      e.event_date,
      e.image_brightness_score,
      v.name AS venue_name,
      e.image_url                 AS event_image_url,
      p.image_url                 AS package_image_url,
      -- Concert image options
      a.fanartv_background_url,
      a.spotify_image_url,
      -- Current marketing pick + score
      gc.marketing_image_url,
      gc.image_brightness_score   AS course_brightness,
      -- All 10 photo slots
      gc.image_url,    gc.image_url_2,  gc.image_url_3,
      gc.image_url_4,  gc.image_url_5,  gc.image_url_6,
      gc.image_url_7,  gc.image_url_8,  gc.image_url_9,
      gc.image_url_10
    FROM public.packages     p
    JOIN public.events       e  ON e.id  = p.event_id
    JOIN public.artists      a  ON a.id  = e.artist_id
    JOIN public.golf_courses gc ON gc.id = p.golf_course_id
    LEFT JOIN public.venues  v  ON v.id  = e.venue_id
    WHERE p.active = true
      AND e.active = true
      AND gc.marketing_image_url IS NOT NULL
      AND e.image_brightness_score IS NOT NULL
      AND e.image_brightness_score <= 70
      -- Allow packages even if no artist image exists yet (user can still pick a golf image and generate)
      -- AND COALESCE(a.fanartv_background_url, a.spotify_image_url) IS NOT NULL
      AND e.event_date BETWEEN CURRENT_DATE + INTERVAL '30 days'
                           AND CURRENT_DATE + INTERVAL '180 days'
      AND ${audienceGenreSql("a.genre")}
      ${cityClause}
      AND p.id NOT IN (
        SELECT package_id FROM public.instagram_queue
        WHERE package_id IS NOT NULL
      )
    ORDER BY e.event_date::date ${order}, a.name ASC
    LIMIT $1
  `, params);
  return rows;
}

// ── Metro city aliases (same as seed-packages-from-discovery.mjs) ────────────
const METRO_MAP = {
  'Landover':'Washington','East Rutherford':'New York','Foxborough':'Boston',
  'Inglewood':'Los Angeles','Santa Clara':'San Jose','Sunrise':'Fort Lauderdale',
  'Elmont':'New York','Uniondale':'New York','Auburn Hills':'Detroit',
  'Commerce City':'Denver','Sandy':'Salt Lake City','Hillsboro':'Portland',
  'Concord':'Charlotte','Bristow':'Washington','Noblesville':'Indianapolis',
  'Tinley Park':'Chicago','Rosemont':'Chicago','Waukegan':'Chicago',
  'Cuyahoga Falls':'Cleveland','Independence':'Cleveland','Mansfield':'Boston',
  'Holmdel':'New York','Wantagh':'New York','The Woodlands':'Houston',
  'Sugar Land':'Houston','Alpharetta':'Atlanta','Duluth':'Atlanta',
  'Chula Vista':'San Diego','Irvine':'Los Angeles','Mountain View':'San Jose',
  'Wheatland':'Sacramento','Clarkston':'Detroit','Burgettstown':'Pittsburgh',
  'Hershey':'Harrisburg','Camden':'Philadelphia','Ridgefield':'Portland',
  'George':'Seattle','West Palm Beach':'Palm Beach',
};

const SLUG_OVERRIDES = {
  'washington-dc': 'Washington', 'new-york-city': 'New York', 'new-york': 'New York',
  'los-angeles': 'Los Angeles', 'san-francisco': 'San Francisco', 'las-vegas': 'Las Vegas',
  'san-diego': 'San Diego', 'san-antonio': 'San Antonio', 'fort-lauderdale': 'Fort Lauderdale',
  'salt-lake-city': 'Salt Lake City', 'kansas-city': 'Kansas City',
  'oklahoma-city': 'Oklahoma City', 'atlantic-city': null,
};
function resolveCity(slug, fallback) {
  if (!slug) return METRO_MAP[fallback] || fallback;
  if (slug in SLUG_OVERRIDES) return SLUG_OVERRIDES[slug];
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ── Golf course name heuristics ───────────────────────────────────────────────
function courseNameIsPlayable(name) {
  const n = (name || '').toLowerCase();
  if (/topgolf|top\s*golf/i.test(n)) return false;
  if (/driving\s*range/i.test(n)) return false;
  if (/mini\s*golf|minigolf|putt-?putt|pitch\s*and\s*putt/i.test(n)) return false;
  if (/simulator|indoor\s*golf|golf\s*simulator/i.test(n)) return false;
  if (/military|naval|navy|marine\s*corps|air\s*force|army|coast\s*guard|\bbase\b|\bmwr\b|\bdod\b/i.test(n)) return false;
  if (/9[\s-]?hole|nine[\s-]?hole|par[\s-]?3\b|par[\s-]?27/i.test(n)) return false;
  if (/putting\s*(green|edge|course)|adventure\s*golf|footgolf|disc\s*golf/i.test(n)) return false;
  if (/academy|instruction|lessons?\b|golf\s*school/i.test(n) && !/course|club|resort|links/i.test(n)) return false;
  if (/\bfive\s*iron\b/i.test(n)) return false;
  if (/\bcity\s*golf\b/i.test(n)) return false;
  if (/\bbig\s*shots?\s*golf\b/i.test(n)) return false;
  if (/\bpopstroke\b/i.test(n)) return false;
  if (/\bx-golf\b|\bxgolf\b/i.test(n)) return false;
  if (/\bputtery\b/i.test(n)) return false;
  if (/golf\s*lounge/i.test(n)) return false;
  if (/lounge.*golf|bar.*golf/i.test(n)) return false;
  return true;
}

async function fetchCandidates({ offset = 0, limit = 15, sort = "score", city = "" } = {}) {
  const { rows: shows } = await pool.query(`
    SELECT * FROM (
      SELECT DISTINCT ON (ds.tm_event_id)
        ds.tm_event_id, ds.artist, ds.city, ds.genre,
        ds.event_date::text AS event_date,
        to_char(ds.event_date::date, 'Mon DD, YYYY') AS event_date_fmt,
        ds.image_url, ds.ticket_url, ds.score, ds.venue, ds.metro_slug
      FROM public.discovery_shows ds
      WHERE ds.active = true
      AND ds.event_date >= CURRENT_DATE + INTERVAL '30 days'
      AND ds.event_date <= CURRENT_DATE + INTERVAL '210 days'
      AND ${audienceScoreSql("ds.score", "ds.genre")}
      AND ${audienceGenreSql("ds.genre")}
        AND ds.artist NOT ILIKE '%tribute%'
        AND ds.artist NOT ILIKE '%revisited%'
        AND ds.event_name NOT ILIKE '%tribute%'
        AND ds.event_name NOT ILIKE '% vs %'
        AND ds.artist NOT ILIKE '%fab four%'
      AND ds.artist NOT ILIKE '%petty kings%'
      AND ds.artist NOT ILIKE '%symphonic celebration%'
      AND ds.artist NOT ILIKE '%changes in latitudes%'
      AND ds.artist NOT ILIKE '%get the led out%'
      AND ds.event_name NOT ILIKE '%symphonic%'
      AND ds.artist NOT ILIKE '%brit floyd%'
      AND ds.artist NOT ILIKE '%forrest frank%'
      AND ds.artist NOT ILIKE '%max mcnown%'
      AND ds.artist NOT ILIKE '%super diamond%'
      AND ds.artist NOT ILIKE '%yacht rock%'
      AND ds.artist NOT ILIKE '%zeppelin%'
      AND ds.artist NOT ILIKE '%dokken%'
      AND ds.artist NOT ILIKE '%boiler room%'
      AND ds.artist NOT ILIKE '%mon laferte%'
      AND ds.artist NOT ILIKE '%arrolladora%'
      AND ds.artist NOT ILIKE '%banda%'
      AND ds.artist NOT ILIKE '%gipsy kings%'
        AND NOT EXISTS (
          SELECT 1 FROM public.packages p
          JOIN public.events e ON e.id = p.event_id
          WHERE e.source_id = ds.tm_event_id AND p.active = true
        )
      ORDER BY ds.tm_event_id, ds.score DESC
    ) sub
    ORDER BY score DESC, event_date ASC
    LIMIT 500
  `);

  const byArtist = new Map();
  for (const show of shows) {
    const lookupCity = resolveCity(show.metro_slug, show.city);
    if (!lookupCity) continue;
    if (city && lookupCity.toLowerCase() !== city.toLowerCase()) continue;
    const { rows: rawCourses } = await pool.query(`
      SELECT id, name, city, state, rating, marketing_image_url
      FROM public.golf_courses
      WHERE LOWER(city) = LOWER($1)
        AND active = true
        AND marketing_image_url IS NOT NULL
        AND verification_status IN ('verified', 'unreviewed')
        AND public_access_confidence IN ('likely_public', 'unknown')
        AND (
          course_type IS NULL
          OR course_type NOT IN ('private','semi_private','resort','military','simulator','driving_range','mini_golf','not_golf')
        )
      ORDER BY image_brightness_score ASC NULLS LAST, rating DESC NULLS LAST
      LIMIT 5
    `, [lookupCity]);
    const courses = rawCourses.filter(c => courseNameIsPlayable(c.name));
    if (!courses.length) continue;

    const artistKey = show.artist.toLowerCase().trim();
    const entry = { show, course: courses[0], lookupCity };
    const prev = byArtist.get(artistKey);
    if (!prev) {
      byArtist.set(artistKey, entry);
      continue;
    }
    const date = String(show.event_date).slice(0, 10);
    const prevDate = String(prev.show.event_date).slice(0, 10);
    const score = Number(show.score) || 0;
    const prevScore = Number(prev.show.score) || 0;
    if (sort === "date_desc") {
      if (date > prevDate) byArtist.set(artistKey, entry);
    } else if (sort === "date_asc") {
      if (date < prevDate) byArtist.set(artistKey, entry);
    } else if (score > prevScore || (score === prevScore && date < prevDate)) {
      byArtist.set(artistKey, entry);
    }
  }

  const all = Array.from(byArtist.values());

  const byDate = (a, b) =>
    String(a.show.event_date).slice(0, 10).localeCompare(String(b.show.event_date).slice(0, 10));
  if (sort === "date_asc") {
    all.sort(byDate);
  } else if (sort === "date_desc") {
    all.sort((a, b) => byDate(b, a));
  } else {
    all.sort((a, b) =>
      (Number(b.show.score) - Number(a.show.score)) || byDate(a, b)
    );
  }

  const safeOffset = Math.max(0, Number(offset) || 0);
  const pageSize = Math.min(50, Math.max(1, Number(limit) || 50));
  return {
    items: all.slice(safeOffset, safeOffset + pageSize),
    total: all.length,
    offset: safeOffset,
    limit: pageSize,
    hasMore: safeOffset + pageSize < all.length,
  };
}

async function scoreImageBrightness(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(buf)
      .resize(100, 100, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i += 3) {
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return Math.round(sum / (info.width * info.height) / 255 * 100);
  } catch { return null; }
}

async function createPackageFromCandidate({ show, course }) {
  // Find or create artist
  let artistId;
  const { rows: existing } = await pool.query(
    `SELECT id FROM public.artists WHERE LOWER(name) = LOWER($1) LIMIT 1`, [show.artist]
  );
  if (existing.length) {
    artistId = existing[0].id;
  } else {
      const { rows: newA } = await pool.query(
        `INSERT INTO public.artists (name, genre) VALUES ($1, $2) RETURNING id`,
        [show.artist, show.genre || null]
      );
    artistId = newA[0].id;
  }

  // Find or create event
  const { rows: existEvt } = await pool.query(
    `SELECT id, image_brightness_score FROM public.events WHERE source_id = $1 LIMIT 1`, [show.tm_event_id]
  );
  let eventId;
  if (existEvt.length) {
    eventId = existEvt[0].id;
    // Score image if not yet scored
    if (existEvt[0].image_brightness_score == null && show.image_url) {
      const score = await scoreImageBrightness(show.image_url);
      if (score != null) {
        await pool.query(`UPDATE public.events SET image_brightness_score=$1 WHERE id=$2`, [score, eventId]);
      }
    }
  } else {
    const brightness = await scoreImageBrightness(show.image_url);
    const { rows: evtRows } = await pool.query(`
      INSERT INTO public.events
        (name, artist_id, event_date, image_url, ticket_url, source_id, source_name, active, image_brightness_score)
      VALUES ($1,$2,$3,$4,$5,$6,'ticketmaster',true,$7)
      RETURNING id
    `, [
      `${show.artist} at ${show.venue || show.city}`,
      artistId, show.event_date, show.image_url, show.ticket_url, show.tm_event_id, brightness,
    ]);
    eventId = evtRows[0].id;
  }

  // Create package
  const pkgName = `${show.artist} + ${course.name} | ${course.city}, ${course.state}`;
  const eventDate = new Date(show.event_date);
  const friday = new Date(eventDate);
  friday.setDate(eventDate.getDate() - ((eventDate.getDay() + 2) % 7));
  const sunday = new Date(friday);
  sunday.setDate(friday.getDate() + 2);

  // Guard: reject course if name heuristic fails (shouldn't happen via UI but safety net)
  if (!courseNameIsPlayable(course.name)) {
    throw new Error(`Course "${course.name}" is not a playable public golf course.`);
  }

  const { rows: existPkg } = await pool.query(
    `SELECT id FROM public.packages WHERE event_id=$1 AND golf_course_id=$2 LIMIT 1`,
    [eventId, course.id]
  );
  if (existPkg.length) return { ok: true, packageId: existPkg[0].id, name: pkgName, alreadyExisted: true };

  const { rows: pkgRows } = await pool.query(`
    INSERT INTO public.packages
      (name, event_id, golf_course_id, city, artist_name, golf_course_name,
       event_name, event_date, price, original_price, category, source, active,
       save_count, verification_status, verification_fail_count,
       package_start_date, package_end_date, image_url)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,825,975,'Golf + Concert','curated',true,
            0,'unverified',0,$9,$10,$11)
    RETURNING id
  `, [
    pkgName, eventId, course.id, course.city,
    show.artist, course.name,
    `${show.artist} at ${show.venue || show.city}`,
    show.event_date,
    friday.toISOString().slice(0,10),
    sunday.toISOString().slice(0,10),
    show.image_url,
  ]);

  return { ok: true, packageId: pkgRows[0]?.id, name: pkgName };
}

/**
 * Rewrite a Google-hosted photo URL to a 1080x1350 center-crop so it fills
 * the portrait slide exactly. Non-Google URLs are returned unchanged.
 */
function toPortraitCrop(url) {
  if (!url || !url.includes("googleusercontent.com")) return url;
  if (/=[^=/]+$/.test(url)) return url.replace(/=[^=/]+$/, "=w1080-h1350-c");
  return `${url}=w1080-h1350-c`;
}

function shortCourseName(name) {
  return String(name || "")
    .replace(/\s+(Municipal\s+)?Golf\s+(Course|Club|Links)\s*$/i, "")
    .trim();
}

function formatCtaDate(d) {
  if (Number.isNaN(d.getTime())) return "";
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ── BannerBear Collections API ────────────────────────────────────────────────
async function generateSlides({ packageId, coursePhoto, concertPhoto, artistName, courseName, city, state, eventDate, rawEventDate, courseRating, venueName }) {
  if (!BB_KEY) throw new Error("BANNERBEAR_API_KEY is not set");

  // ── Day-of-week + location strings ─────────────────────────────────────────
  const days    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dateStr = String(rawEventDate || "").slice(0, 10); // handles full ISO or "YYYY-MM-DD"
  const d       = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(dateStr + "T12:00:00") : new Date(eventDate);
  const dayName = Number.isNaN(d.getTime()) ? "" : days[d.getDay()];
  const stateStr  = state ? `, ${state}` : "";
  const bodyCopy  = `${dayName} Night | ${city}${stateStr}`;
  const cityState = `${city}${stateStr}`;

  // Golf day = day before the concert (e.g. concert Monday → golf Sunday)
  const golfDate  = new Date(d);
  golfDate.setDate(golfDate.getDate() - 1);
  const golfDay   = Number.isNaN(golfDate.getTime()) ? "" : days[golfDate.getDay()];

  const ctaEventDate = formatCtaDate(d) || eventDate;
  const ctaBodyCopy = dayName && golfDay
    ? `${artistName} ${dayName} night. ${shortCourseName(courseName)} ${golfDay} morning. One platform. Zero hassle.`
    : `${artistName}. One platform. Zero hassle.`;
  const courseLabel = venueName
    ? `${golfDay} Morning · Near ${venueName}`
    : `${golfDay} Morning · ${cityState}`;

  // Slide header, e.g. "Houston Golf & Concert Escape"
  const packageTitle = `${city} Golf & Concert Escape`;

  // ── Hook copy — deterministic variant per package, char-limit validated ─────
  const hook = normalizeHook(pickHookVariant(packageId));

  const createRes = await fetch("https://sync.api.bannerbear.com/v2/collections", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template_set: BB_TEMPLATE,
      modifications: [
        // ── Hook slide (EC Reel Hook Slide — images[0]) ───────────────────
        { name: "hook_label",    text: hook.hook_label },
        { name: "hook_headline", text: hook.hook_headline },
        { name: "hook_subhead",  text: hook.hook_subhead },
        { name: "hook_pill_text",text: hook.hook_pill_text },
        { name: "website_url",   text: "experiencecaddie.com" },

        // ── Artist/Concert slide (EC Concert Slide — images[1]) ───────────
        { name: "package_title", text: packageTitle },
        { name: "event_label",  text: bodyCopy },
        { name: "artist_name",  text: artistName },
        { name: "event_detail", text: `${eventDate}  ·  ${cityState}` },
        { name: "concert_bg",   image_url: concertPhoto },

        // ── Golf slide (EC Golf Slide — images[2]) ────────────────────────
        { name: "course_photo",  image_url: toPortraitCrop(coursePhoto) },
        { name: "course_name",   text: courseName },
        { name: "course_label",  text: courseLabel },
        { name: "course_detail", text: `${courseRating ? `★ ${courseRating}  ` : ""}${cityState}` },

        // ── Booking/CTA slide (EC CTA Slide — images[3]) ─────────────────
        { name: "city",       text: city },
        { name: "event_date", text: ctaEventDate },
        { name: "body_copy",  text: ctaBodyCopy },
      ],
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`BannerBear ${createRes.status}: ${body.slice(0, 300)}`);
  }

  const result = await createRes.json();
  // BannerBear returns images in REVERSE template-set order.
  // Template set: [Hook, CTA, Golf, Concert] → images: [Concert, Golf, CTA, Hook]
  const images = result.images ?? [];
  return {
    uid:               result.uid,
    concert_slide_url: images[0]?.image_url ?? null,  // EC Concert Slide (artist photo)
    golf_slide_url:    images[1]?.image_url ?? null,  // EC Golf Slide
    cta_slide_url:     images[2]?.image_url ?? null,  // EC CTA Slide (Build My Weekend)
    hook_slide_url:    images[3]?.image_url ?? null,  // EC Reel Hook Slide
  };
}

// ── HTTP request body parser ──────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end",  () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

// ── HTML UI ───────────────────────────────────────────────────────────────────
const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EC Post Review</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:      #111;
    --surface: #1a1a1a;
    --surface2: #222;
    --border:  #2a2a2a;
    --orange:  #E87D30;
    --orange2: #c96820;
    --green:   #2d7d46;
    --green2:  #246038;
    --text:    #e8e8e8;
    --muted:   #888;
  }
  body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif;
         min-height: 100vh; padding: 24px; }
  h1 { font-size: 1.4rem; font-weight: 700; color: var(--orange);
       border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 8px; }
  h1 span { color: var(--muted); font-weight: 400; font-size: 1rem; margin-left: 8px; }
  .page-sub { color: var(--muted); font-size: 0.85rem; margin-bottom: 24px; }

  /* ── Screen management ── */
  .screen { display: none; }
  .screen.active { display: block; }

  /* ── Package picker (Screen 1) ── */
  .pick-toolbar { display: flex; align-items: center; justify-content: space-between;
                  margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
  .pick-count { font-size: 0.9rem; color: var(--muted); }
  .pick-count strong { color: var(--orange); }
  .sort-control { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--muted); }
  .sort-control select { background: var(--surface2); color: var(--text); border: 1px solid var(--border);
                         border-radius: 6px; padding: 7px 10px; font-size: 0.82rem; cursor: pointer; }

  .pkg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .pkg-card { background: var(--surface); border: 2px solid var(--border); border-radius: 12px;
              padding: 0; overflow: hidden; cursor: pointer; transition: border-color 0.15s;
              display: flex; flex-direction: column; }
  .pkg-card:hover { border-color: #444; }
  .pkg-card.picked { border-color: var(--orange); }

  .pkg-thumb { width: 100%; height: 140px; object-fit: cover; display: block; }
  .pkg-thumb-placeholder { width: 100%; height: 140px; background: var(--surface2);
                            display: flex; align-items: center; justify-content: center;
                            font-size: 2rem; color: var(--border); }

  .pkg-body { padding: 14px; flex: 1; display: flex; flex-direction: column; gap: 6px; }
  .pkg-artist { font-size: 1rem; font-weight: 700; color: var(--text); }
  .pkg-course { font-size: 0.82rem; color: var(--muted); }
  .pkg-meta { display: flex; gap: 10px; font-size: 0.78rem; color: var(--muted); flex-wrap: wrap; margin-top: 2px; }
  .pkg-meta .date { color: var(--orange); font-weight: 600; }

  .pkg-footer { padding: 10px 14px; border-top: 1px solid var(--border);
                display: flex; align-items: center; justify-content: space-between; }
  .pick-badge { font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 20px;
                background: var(--orange); color: #fff; display: none; }
  .pkg-card.picked .pick-badge { display: inline-block; }
  .pick-hint { font-size: 0.75rem; color: var(--muted); }
  .pkg-card.picked .pick-hint { display: none; }

  /* ── Review (Screen 2) ── */
  .review-toolbar { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  .btn-back { background: transparent; color: var(--muted); border: 1px solid var(--border);
              padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 600; }
  .btn-back:hover { color: var(--text); border-color: #555; }

  .review-cards { display: flex; gap: 24px; flex-wrap: wrap; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
          padding: 20px; flex: 1; min-width: 340px; max-width: 680px; }
  .card-header { margin-bottom: 16px; }
  .card-header h2 { font-size: 1.1rem; font-weight: 600; color: var(--orange); margin-bottom: 4px; }
  .card-header .meta { color: var(--muted); font-size: 0.82rem; display: flex; gap: 12px; flex-wrap: wrap; }

  .section { margin-top: 16px; }
  .section-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
                   letter-spacing: 0.08em; color: var(--muted); margin-bottom: 10px; }

  .thumb-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .thumb { width: 150px; height: 150px; object-fit: cover; border-radius: 6px; cursor: pointer;
           border: 3px solid transparent; transition: border-color 0.15s, transform 0.1s; flex-shrink: 0; }
  .thumb:hover { transform: scale(1.03); border-color: #555; }
  .thumb.selected { border-color: var(--orange) !important; box-shadow: 0 0 0 1px var(--orange); }
  .thumb-wrap { position: relative; }
  .thumb-label { position: absolute; bottom: 4px; left: 4px; background: rgba(0,0,0,.7);
                 font-size: 0.6rem; color: #ccc; padding: 2px 5px; border-radius: 3px; pointer-events: none; }

  .concert-grid { display: flex; gap: 8px; flex-wrap: wrap; }
  .concert-opt { cursor: pointer; border-radius: 6px; border: 3px solid transparent;
                 transition: border-color 0.15s; overflow: hidden; position: relative; }
  .concert-opt img { width: 150px; height: 150px; object-fit: cover; display: block; }
  .concert-opt:hover { border-color: #555; }
  .concert-opt.selected { border-color: var(--orange) !important; box-shadow: 0 0 0 1px var(--orange); }

  .actions { margin-top: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  button { padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer;
           font-size: 0.9rem; font-weight: 600; transition: opacity 0.15s; }
  button:disabled { opacity: 0.35; cursor: not-allowed; }
  .btn-generate { background: var(--orange); color: #fff; }
  .btn-generate:hover:not(:disabled) { background: var(--orange2); }
  .btn-approve  { background: var(--green); color: #fff; }
  .btn-approve:hover:not(:disabled)  { background: var(--green2); }
  .btn-skip     { background: transparent; color: var(--muted); border: 1px solid var(--border); }
  .btn-skip:hover:not(:disabled)     { color: var(--text); border-color: #555; }
  .btn-review   { background: var(--orange); color: #fff; padding: 11px 28px; font-size: 1rem; }
  .btn-review:hover:not(:disabled)   { background: var(--orange2); }
  .btn-review:disabled               { opacity: 0.35; cursor: not-allowed; }

  .slides-row { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
  .slide-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .slide-wrap img { width: 260px; border-radius: 8px; border: 1px solid var(--border); }
  .slide-wrap .slide-label { font-size: 0.72rem; color: var(--muted); }

  .status-msg { font-size: 0.85rem; padding: 8px 12px; border-radius: 6px; margin-top: 12px; }
  .status-msg.ok    { background: #1a3d27; color: #5cde8a; }
  .status-msg.err   { background: #3d1a1a; color: #f87171; }
  .status-msg.info  { background: #1a2a3d; color: #7db8f8; }

  .no-key-warn { background: #2d2010; color: #f5a623; border: 1px solid #5a3d18;
                 border-radius: 8px; padding: 10px 14px; font-size: 0.82rem; margin-bottom: 20px; }
  .loading { color: var(--muted); font-style: italic; padding: 40px; text-align: center; }
  .empty   { color: var(--muted); text-align: center; padding: 60px; font-size: 1rem; }

  /* ── Candidates panel ── */
  .candidates-section { margin-top: 32px; border-top: 1px solid var(--border); padding-top: 24px; }
  .candidates-header { display: flex; align-items: center; justify-content: space-between;
                        margin-bottom: 16px; flex-wrap: wrap; gap: 10px; }
  .candidates-header h2 { font-size: 1rem; font-weight: 700; color: var(--text); }
  .candidates-header p  { font-size: 0.82rem; color: var(--muted); }
  .cand-nav { display: flex; gap: 8px; flex-wrap: wrap; }
  .cand-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .cand-card { background: var(--surface2); border: 1px solid var(--border); border-radius: 10px;
               padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .cand-artist { font-size: 0.95rem; font-weight: 700; }
  .cand-meta   { font-size: 0.78rem; color: var(--muted); line-height: 1.5; }
  .cand-meta .date { color: var(--orange); font-weight: 600; }
  .cand-course { font-size: 0.78rem; color: #7db8f8; }
  .btn-add { margin-top: auto; background: var(--green); color: #fff; padding: 7px 14px;
             border-radius: 6px; border: none; cursor: pointer; font-size: 0.82rem;
             font-weight: 600; width: 100%; transition: background 0.15s; }
  .btn-add:hover:not(:disabled)    { background: var(--green2); }
  .btn-add:disabled { opacity: 0.5; cursor: not-allowed; }
  .cand-msg { font-size: 0.75rem; text-align: center; }
  .cand-msg.ok  { color: #5cde8a; }
  .cand-msg.err { color: #f87171; }
</style>
</head>
<body>
<h1>Experience Caddie <span>Instagram Post Review</span></h1>

<div id="no-key-warn" class="no-key-warn" style="display:none">
  ⚠ <strong>BANNERBEAR_API_KEY not set</strong> — image generation disabled.
  Add the key to <code>.env</code> and restart the server.
</div>

<!-- Screen 1: Package Picker -->
<div id="screen-pick" class="screen active">
  <p class="page-sub">Select the packages you want to build reels for, then click Review Selected.</p>
  <div class="pick-toolbar">
    <span class="pick-count" id="pick-count">Loading…</span>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <label class="sort-control">City
        <select id="city-filter" onchange="setCityFilter(this.value)">
          <option value="">All cities</option>
        </select>
      </label>
      <label class="sort-control">Sort
        <select id="list-sort" onchange="setListSort(this.value)">
          <option value="date_asc">Date — soonest</option>
          <option value="date_desc">Date — latest</option>
          <option value="score">Best match</option>
        </select>
      </label>
      <button class="btn-review" id="btn-review" disabled onclick="goToReview()">Review Selected (0)</button>
    </div>
  </div>
  <div id="pkg-grid" class="pkg-grid"><div class="loading">Loading packages…</div></div>
</div>

  <!-- Candidates panel (bottom of Screen 1) -->
  <div class="candidates-section">
    <div class="candidates-header">
      <div>
        <h2>Package Candidates</h2>
        <p>Discovery shows not yet in the catalog — Country, Rock &amp; Americana only.</p>
      </div>
      <div class="cand-nav">
        <button class="btn-back" onclick="loadCandidates({ previous: true })" id="btn-cand-prev" disabled>← Previous</button>
        <button class="btn-back" onclick="loadCandidates({ advance: true })" id="btn-cand-next">Show More →</button>
      </div>
    </div>
    <p class="page-sub" id="cand-batch-info" style="margin-top:-8px;margin-bottom:12px"></p>
    <div id="cand-grid" class="cand-grid"><div class="loading" style="padding:20px">Loading candidates…</div></div>
  </div>
</div>

<!-- Screen 2: Image Review + Generate -->
<div id="screen-review" class="screen">
  <div class="review-toolbar">
    <button class="btn-back" onclick="goToPick()">← Back to packages</button>
    <span id="review-title" style="color:var(--muted);font-size:0.9rem"></span>
  </div>
  <div id="review-cards" class="review-cards"></div>
</div>

<script>
const BB_ENABLED = __BB_ENABLED__;
const FEATURED_CITIES = __FEATURED_CITIES__;
let allPackages = [];   // all returned from API
let pickedIds   = new Set();  // package IDs the user has selected
let reviewList  = [];   // packages being reviewed (ordered by pick)
let listSort    = 'date_asc';
let cityFilter  = '';
const selected  = {};   // { [reviewIdx]: { courseUrl, courseLabel, concertUrl, concertType, generated } }

if (!BB_ENABLED) document.getElementById('no-key-warn').style.display = '';

function concertImageUrl(pkg) {
  return pkg.fanartv_background_url || pkg.spotify_image_url
    || pkg.event_image_url || pkg.package_image_url || null;
}
function concertImageType(pkg) {
  if (pkg.fanartv_background_url) return 'fanart';
  if (pkg.spotify_image_url) return 'spotify';
  if (pkg.event_image_url || pkg.package_image_url) return 'event';
  return null;
}

// ── Screen switching ──────────────────────────────────────────────────────────
function goToReview() {
  if (!pickedIds.size) return;
  reviewList = allPackages.filter(p => pickedIds.has(p.id));
  // Reset selection state for this review session
  reviewList.forEach((p, i) => {
    selected[i] = {
      courseUrl:   p.marketing_image_url,
      courseLabel: 'auto-pick',
      concertUrl:  concertImageUrl(p),
      concertType: concertImageType(p),
    };
  });
  document.getElementById('review-cards').innerHTML = reviewList.map(renderReviewCard).join('');
  // Apply pre-selected highlights
  reviewList.forEach((p, i) => {
    highlightCourse(i, selected[i].courseUrl);
    highlightConcert(i, selected[i].concertType);
  });
  document.getElementById('review-title').textContent =
    \`Reviewing \${reviewList.length} package\${reviewList.length !== 1 ? 's' : ''}\`;
  document.getElementById('screen-pick').classList.remove('active');
  document.getElementById('screen-review').classList.add('active');
  window.scrollTo(0, 0);
}

function goToPick() {
  document.getElementById('screen-review').classList.remove('active');
  document.getElementById('screen-pick').classList.add('active');
  window.scrollTo(0, 0);
}

// ── Load all packages ─────────────────────────────────────────────────────────
async function load() {
  try {
    const cityQs = cityFilter ? \`&city=\${encodeURIComponent(cityFilter)}\` : '';
    const res  = await fetch(\`/api/packages?sort=\${listSort}\${cityQs}\`);
    allPackages = await res.json();
    renderPickScreen();
  } catch(e) {
    document.getElementById('pkg-grid').innerHTML =
      '<div class="loading" style="color:#f87171">Failed to load: ' + e.message + '</div>';
    document.getElementById('pick-count').textContent = 'Error loading packages';
  }
}

function renderPickScreen() {
  const grid = document.getElementById('pkg-grid');
  if (!allPackages.length) {
    grid.innerHTML = '<div class="empty">No eligible packages right now.<br><small>Check back when new events are within 30–180 days.</small></div>';
    document.getElementById('pick-count').textContent = '0 packages available';
    return;
  }
  document.getElementById('pick-count').innerHTML =
    \`<strong>\${allPackages.length}</strong> packages available\`;
  grid.innerHTML = allPackages.map(renderPickCard).join('');
  pickedIds.forEach(id => {
    const el = document.getElementById(\`pkgcard-\${id}\`);
    if (el) el.classList.add('picked');
  });
}

function setListSort(value) {
  listSort = value;
  candOffset = 0;
  const sel = document.getElementById('list-sort');
  if (sel) sel.value = value;
  load();
  loadCandidates();
}

function setCityFilter(value) {
  cityFilter = value;
  candOffset = 0;
  load();
  loadCandidates();
}

function renderPickCard(pkg) {
  const thumb = concertImageUrl(pkg);
  const thumbHtml = thumb
    ? \`<img class="pkg-thumb" src="\${thumb}" alt="\${pkg.artist_name}" loading="lazy">\`
    : \`<div class="pkg-thumb-placeholder">♪</div>\`;
  return \`
  <div class="pkg-card" id="pkgcard-\${pkg.id}" onclick="togglePick('\${pkg.id}')">
    \${thumbHtml}
    <div class="pkg-body">
      <div class="pkg-artist">\${pkg.artist_name}</div>
      <div class="pkg-course">\${pkg.course_name}</div>
      <div class="pkg-meta">
        <span class="date">\${pkg.event_date_fmt}</span>
        <span>\${pkg.city}, \${pkg.course_state}</span>
      </div>
    </div>
    <div class="pkg-footer">
      <span class="pick-hint">Click to select</span>
      <span class="pick-badge">✓ Selected</span>
    </div>
  </div>\`;
}

function togglePick(id) {
  if (pickedIds.has(id)) {
    pickedIds.delete(id);
    document.getElementById(\`pkgcard-\${id}\`).classList.remove('picked');
  } else {
    pickedIds.add(id);
    document.getElementById(\`pkgcard-\${id}\`).classList.add('picked');
  }
  const n = pickedIds.size;
  document.getElementById('btn-review').textContent = \`Review Selected (\${n})\`;
  document.getElementById('btn-review').disabled = n === 0;
}

// ── Review card ───────────────────────────────────────────────────────────────
function renderReviewCard(pkg, i) {
  const courseSlots = [
    ['image_url','1'],['image_url_2','2'],['image_url_3','3'],
    ['image_url_4','4'],['image_url_5','5'],['image_url_6','6'],
    ['image_url_7','7'],['image_url_8','8'],['image_url_9','9'],['image_url_10','10'],
  ].filter(([col]) => pkg[col]);

  const courseThumbs = courseSlots.map(([col, label]) => \`
    <div class="thumb-wrap">
      <img class="thumb" data-card="\${i}" src="\${pkg[col]}" alt="slot \${label}" loading="lazy"
           onclick="selectCourse(\${i}, this.src, 'slot \${label}')">
      <span class="thumb-label">slot \${label}</span>
    </div>\`).join('');

  const concertOpts = [];
  if (pkg.fanartv_background_url) concertOpts.push(\`
    <div class="concert-opt" id="concert-\${i}-fanart" onclick="selectConcert(\${i}, '\${pkg.fanartv_background_url}', 'fanart')">
      <img src="\${pkg.fanartv_background_url}" alt="Fanart.tv" loading="lazy">
      <span class="thumb-label">Fanart.tv</span>
    </div>\`);
  if (pkg.spotify_image_url) concertOpts.push(\`
    <div class="concert-opt" id="concert-\${i}-spotify" onclick="selectConcert(\${i}, '\${pkg.spotify_image_url}', 'spotify')">
      <img src="\${pkg.spotify_image_url}" alt="Spotify" loading="lazy">
      <span class="thumb-label">Spotify</span>
    </div>\`);
  const eventImg = pkg.event_image_url || pkg.package_image_url;
  if (eventImg) concertOpts.push(\`
    <div class="concert-opt" id="concert-\${i}-event" onclick="selectConcert(\${i}, '\${eventImg}', 'event')">
      <img src="\${eventImg}" alt="Ticketmaster" loading="lazy">
      <span class="thumb-label">Ticketmaster</span>
    </div>\`);
  if (!concertOpts.length) concertOpts.push('<div class="loading" style="padding:8px;font-size:0.8rem">No concert image — run Spotify/Fanart backfill</div>');

  return \`
  <div class="card" id="card-\${i}">
    <div class="card-header">
      <h2>\${pkg.artist_name}</h2>
      <div class="meta">
        <span>\${pkg.event_date_fmt}</span>
        <span>\${pkg.city}, \${pkg.course_state}</span>
        <span>\${pkg.course_name}</span>
        \${pkg.course_rating ? \`<span>★ \${pkg.course_rating}</span>\` : ''}
      </div>
    </div>

    <div class="section">
      <div class="section-label">Course Photo — click to select</div>
      <div class="thumb-grid">\${courseThumbs}</div>
    </div>

    <div class="section">
      <div class="section-label">Concert Background — click to select</div>
      <div class="concert-grid">\${concertOpts.join('')}</div>
    </div>

    <div id="slides-\${i}"></div>

    <div class="actions">
      <button class="btn-generate" \${BB_ENABLED ? '' : 'disabled title="No BB key"'}
              onclick="generate(\${i})">Generate Slides</button>
      <button class="btn-approve" id="btn-approve-\${i}" disabled onclick="approve(\${i})">Approve</button>
      <button class="btn-skip" onclick="skip(\${i})">Skip</button>
    </div>
    <div id="msg-\${i}"></div>
  </div>\`;
}

// ── Selection helpers ─────────────────────────────────────────────────────────
function highlightCourse(i, url) {
  document.querySelectorAll(\`.thumb[data-card="\${i}"]\`).forEach(el => {
    el.classList.toggle('selected', el.src === url);
  });
}
function highlightConcert(i, type) {
  ['fanart','spotify','event'].forEach(t => {
    const el = document.getElementById(\`concert-\${i}-\${t}\`);
    if (el) el.classList.toggle('selected', t === type);
  });
}
function selectCourse(i, url, label) {
  if (!selected[i]) selected[i] = {};
  selected[i].courseUrl = url; selected[i].courseLabel = label;
  highlightCourse(i, url);
}
function selectConcert(i, url, type) {
  if (!selected[i]) selected[i] = {};
  selected[i].concertUrl = url; selected[i].concertType = type;
  highlightConcert(i, type);
}

// ── Generate ──────────────────────────────────────────────────────────────────
async function generate(i) {
  const pkg   = reviewList[i];
  const sel   = selected[i] || {};
  const msgEl = document.getElementById(\`msg-\${i}\`);
  msgEl.innerHTML = '<div class="status-msg info">Generating slides… 10–20 s</div>';
  try {
    const res = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageId:    pkg.id,
        artistName:   pkg.artist_name,
        courseName:   pkg.course_name,
        city:         pkg.city,
        state:        pkg.course_state,
        eventDate:    pkg.event_date_fmt,
        rawEventDate: pkg.event_date,
        courseRating: pkg.course_rating,
        venueName:    pkg.venue_name,
        coursePhoto:  sel.courseUrl  || pkg.marketing_image_url,
        concertPhoto: sel.concertUrl || concertImageUrl(pkg),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generate failed');
    selected[i].generated = data;
    document.getElementById(\`slides-\${i}\`).innerHTML = \`
      <div class="section">
        <div class="section-label">Generated Slides</div>
        <div class="slides-row">
          \${['hook_slide_url','concert_slide_url','golf_slide_url','cta_slide_url'].map((k, si) => {
            const labels = ['Hook','Artist','Golf','Booking'];
            return data[k] ? \`<div class="slide-wrap"><img src="\${data[k]}" alt="\${labels[si]}"><span class="slide-label">\${labels[si]}</span></div>\` : '';
          }).join('')}
        </div>
      </div>\`;
    document.getElementById(\`btn-approve-\${i}\`).disabled = false;
    msgEl.innerHTML = '<div class="status-msg ok">✓ Slides generated</div>';
  } catch(e) {
    msgEl.innerHTML = \`<div class="status-msg err">✗ \${e.message}</div>\`;
  }
}

// ── Approve ───────────────────────────────────────────────────────────────────
async function approve(i) {
  const pkg   = reviewList[i];
  const sel   = selected[i] || {};
  const msgEl = document.getElementById(\`msg-\${i}\`);
  try {
    const res = await fetch('/api/approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageId:            pkg.id,
        artistName:           pkg.artist_name,
        courseName:           pkg.course_name,
        city:                 pkg.city,
        eventDate:            pkg.event_date_fmt,
        selectedCoursePhoto:  sel.courseUrl  || pkg.marketing_image_url,
        selectedConcertPhoto: sel.concertUrl || concertImageUrl(pkg),
        hookSlideUrl:         sel.generated?.hook_slide_url    || null,
        concertSlideUrl:      sel.generated?.concert_slide_url || null,
        golfSlideUrl:         sel.generated?.golf_slide_url    || null,
        ctaSlideUrl:          sel.generated?.cta_slide_url     || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Approve failed');
    const schedMsg = data.scheduledAt
      ? \` — scheduled in Buffer for \${new Date(data.scheduledAt).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}\`
      : ' — saved to queue';
    msgEl.innerHTML = \`<div class="status-msg ok">✓ Approved\${schedMsg}</div>\`;
    document.getElementById(\`card-\${i}\`).style.opacity = '0.4';
    document.getElementById(\`card-\${i}\`).style.pointerEvents = 'none';
  } catch(e) {
    msgEl.innerHTML = \`<div class="status-msg err">✗ \${e.message}</div>\`;
  }
}

// ── Skip ──────────────────────────────────────────────────────────────────────
async function skip(i) {
  const pkg   = reviewList[i];
  const msgEl = document.getElementById(\`msg-\${i}\`);
  try {
    await fetch('/api/skip', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageId: pkg.id }),
    });
    msgEl.innerHTML = '<div class="status-msg info">↷ Skipped</div>';
    document.getElementById(\`card-\${i}\`).style.opacity = '0.4';
    document.getElementById(\`card-\${i}\`).style.pointerEvents = 'none';
    // Remove from picker grid too
    const cardEl = document.getElementById(\`pkgcard-\${pkg.id}\`);
    if (cardEl) cardEl.style.opacity = '0.3';
  } catch(e) {
    msgEl.innerHTML = \`<div class="status-msg err">✗ \${e.message}</div>\`;
  }
}

// ── Candidates ────────────────────────────────────────────────────────────────
const CAND_PAGE = 50;
let candOffset = 0;
let candTotal  = 0;

async function loadCandidates({ advance = false, previous = false } = {}) {
  const grid = document.getElementById('cand-grid');
  const info = document.getElementById('cand-batch-info');
  const prevBtn = document.getElementById('btn-cand-prev');
  const nextBtn = document.getElementById('btn-cand-next');
  grid.innerHTML = '<div class="loading" style="padding:20px">Loading candidates…</div>';
  try {
    if (previous) candOffset = Math.max(0, candOffset - CAND_PAGE);
    else if (advance) candOffset += CAND_PAGE;

    const cityQs = cityFilter ? \`&city=\${encodeURIComponent(cityFilter)}\` : '';
    const res  = await fetch(\`/api/candidates?offset=\${candOffset}&limit=\${CAND_PAGE}&sort=\${listSort}\${cityQs}\`);
    const data = await res.json();
    const batch = data.items ?? data;

    if (!batch.length) {
      if (advance && candOffset > 0) {
        candOffset = 0;
        return loadCandidates();
      }
      info.textContent = '';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      grid.innerHTML = '<div class="loading" style="padding:20px;color:var(--muted)">No matching candidates right now — try Show More or run the artist backfill script.</div>';
      return;
    }

    candOffset = data.offset ?? candOffset;
    candTotal  = data.total ?? batch.length;
    const end = Math.min(candOffset + batch.length, candTotal);
    info.textContent = \`Showing \${candOffset + 1}–\${end} of \${candTotal}\`;
    if (prevBtn) prevBtn.disabled = candOffset <= 0;
    if (nextBtn) nextBtn.disabled = candOffset + CAND_PAGE >= candTotal;
    grid.innerHTML = batch.map(renderCandCard).join('');
  } catch(e) {
    info.textContent = '';
    grid.innerHTML = \`<div class="loading" style="color:#f87171;padding:20px">Failed to load: \${e.message}</div>\`;
  }
}

function renderCandCard(c) {
  const { show, course } = c;
  const id = show.tm_event_id;
  return \`
  <div class="cand-card" id="cand-\${id}">
    <div class="cand-artist">\${show.artist}</div>
    <div class="cand-meta">
      <span class="date">\${show.event_date_fmt}</span>
      &nbsp;·&nbsp;\${show.city}
      &nbsp;·&nbsp;\${show.genre}
    </div>
    <div class="cand-course">⛳ \${course.name}, \${course.city}, \${course.state}</div>
    <button class="btn-add" id="btn-add-\${id}"
            onclick="addCandidate('\${id}', this)">+ Add Package</button>
    <div class="cand-msg" id="cand-msg-\${id}"></div>
  </div>\`;
}

async function addCandidate(tmEventId, btn) {
  const msgEl = document.getElementById(\`cand-msg-\${tmEventId}\`);
  btn.disabled = true;
  btn.textContent = 'Adding…';
  try {
    // find the full candidate object
    const res0 = await fetch(\`/api/candidates?offset=\${candOffset}&limit=\${CAND_PAGE}&sort=\${listSort}\${cityFilter ? '&city=' + encodeURIComponent(cityFilter) : ''}\`);
    const payload = await res0.json();
    const all  = payload.items ?? payload;
    const cand = all.find(c => c.show.tm_event_id === tmEventId);
    if (!cand) throw new Error('Candidate not found — may already exist');

    const res = await fetch('/api/candidates/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cand),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Create failed');

    btn.textContent = '✓ Added';
    msgEl.textContent = 'Refresh the package picker to see it.';
    msgEl.className = 'cand-msg ok';
    // Refresh main package list count
    await load();
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '+ Add Package';
    msgEl.textContent = e.message;
    msgEl.className = 'cand-msg err';
  }
}

load();
initCityFilter();
loadCandidates();

function initCityFilter() {
  const sel = document.getElementById('city-filter');
  if (!sel) return;
  for (const c of FEATURED_CITIES) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    sel.appendChild(o);
  }
}
</script>
</body>
</html>`;

// Replace template placeholder with runtime value
const serveHTML = HTML
  .replace("__BB_ENABLED__", BB_KEY ? "true" : "false")
  .replace("__FEATURED_CITIES__", JSON.stringify(FEATURED_CITIES));

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;

  try {
    // GET /
    if (method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(serveHTML);
      return;
    }

    // GET /api/packages
    if (method === "GET" && url.pathname === "/api/packages") {
      const sort = url.searchParams.get("sort") || "date_asc";
      const city = url.searchParams.get("city") || "";
      const rows = await fetchPackages(50, sort, city);
      return json(res, 200, rows);
    }

    // GET /api/candidates — discovery shows without packages, with best matching course
    if (method === "GET" && url.pathname === "/api/candidates") {
      const offset = Number(url.searchParams.get("offset") || 0);
      const limit  = Number(url.searchParams.get("limit")  || 50);
      const sort   = url.searchParams.get("sort") || "score";
      const city   = url.searchParams.get("city") || "";
      const result = await fetchCandidates({ offset, limit, sort, city });
      return json(res, 200, result);
    }

    // POST /api/candidates/create — create event + package for one candidate
    if (method === "POST" && url.pathname === "/api/candidates/create") {
      const body = await readBody(req);
      const result = await createPackageFromCandidate(body);
      return json(res, 200, result);
    }

    // POST /api/generate
    if (method === "POST" && url.pathname === "/api/generate") {
      if (!BB_KEY) return json(res, 503, { error: "BANNERBEAR_API_KEY not set" });
      const body = await readBody(req);
      const result = await generateSlides(body);
      return json(res, 200, result);
    }

    // POST /api/approve
    if (method === "POST" && url.pathname === "/api/approve") {
      const body = await readBody(req);

      // Carousel order: Hook → Concert → Golf → CTA
      const slides = [
        body.hookSlideUrl, body.concertSlideUrl, body.golfSlideUrl, body.ctaSlideUrl,
      ].filter(Boolean);

      // Schedule in Buffer immediately if credentials are available
      let bufferPostId  = null;
      let scheduledAt   = null;
      let status        = "pending";
      if (BUFFER_TOKEN && BUFFER_CHAN && slides.length >= 2) {
        try {
          scheduledAt  = nextPostSlot();
          const caption = buildCaption({
            artistName:       body.artistName,
            courseCourseName: body.courseName,
            city:             body.city,
            eventDateFmt:     body.eventDate,
          });
          bufferPostId = await scheduleInBuffer({ slides, caption, scheduledAt });
          status = "scheduled";
          console.log(`[approve] Scheduled in Buffer: ${bufferPostId} @ ${scheduledAt.toISOString()}`);
        } catch (e) {
          console.error(`[approve] Buffer scheduling failed: ${e.message} — saving as pending`);
          scheduledAt = null;
          status = "pending";
        }
      }

      const row = {
        package_id:              body.packageId,
        selected_course_photo:   body.selectedCoursePhoto,
        selected_concert_photo:  body.selectedConcertPhoto,
        hook_slide_url:          body.hookSlideUrl    || null,
        concert_slide_url:       body.concertSlideUrl || null,
        golf_slide_url:          body.golfSlideUrl    || null,
        cta_slide_url:           body.ctaSlideUrl     || null,
        status,
        posted_at: scheduledAt ?? null,
      };
      const inserted = await supabaseInsert("instagram_queue", row);
      return json(res, 200, {
        ok: true,
        id: inserted?.[0]?.id,
        bufferId: bufferPostId,
        scheduledAt: scheduledAt?.toISOString() ?? null,
      });
    }

    // POST /api/skip
    if (method === "POST" && url.pathname === "/api/skip") {
      const body = await readBody(req);
      await supabaseInsert("instagram_queue", {
        package_id: body.packageId,
        status: "skipped",
      });
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(`[${method} ${url.pathname}]`, err.message);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`\n  Experience Caddie Review Tool`);
  console.log(`  ─────────────────────────────`);
  console.log(`  URL  : ${addr}`);
  console.log(`  BB   : ${BB_KEY ? "✓ BannerBear enabled" : "✗ No BB key — generate disabled"}`);
  console.log(`  DB   : ${process.env.PGHOST}`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  // Try to open browser (works on Mac/Linux; Windows uses 'start')
  const cmd = process.platform === "win32" ? `start ${addr}`
            : process.platform === "darwin" ? `open ${addr}` : `xdg-open ${addr}`;
  exec(cmd, () => {});
});
