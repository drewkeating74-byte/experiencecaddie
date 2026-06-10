/**
 * seed-packages-from-discovery.mjs
 *
 * Converts eligible discovery_shows rows into events + packages.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-packages-from-discovery.mjs            # dry-run (default)
 *   node --env-file=.env scripts/seed-packages-from-discovery.mjs --create   # write to DB
 *   node --env-file=.env scripts/seed-packages-from-discovery.mjs --limit 5  # cap candidates
 *
 * Matching logic:
 *   1. Show city → direct golf_courses city match.
 *   2. Show city → METRO_MAP fallback (e.g. Landover → Washington).
 *   3. Among matching courses, pick the one with the best image quality
 *      (marketing_image_url scored, lowest brightness = most dramatic).
 *
 * Package defaults:
 *   price = 825, category = "Golf + Concert", source = "curated",
 *   verification_status = "pending"
 */

import pg from 'pg';
import sharp from 'sharp';

const CREATE  = process.argv.includes('--create');
const LIMIT   = (() => { const i = process.argv.indexOf('--limit'); return i !== -1 ? Number(process.argv[i+1]) : 50; })();
const DRY_RUN = !CREATE;

// ── Genre rules ──────────────────────────────────────────────────────────────
// Matches the curated backfill target audience (BACKFILL_GENRES in verify-packages).
// Latin, R&B, and Hip-Hop are in the discovery cache but not suitable for the
// golf-weekend audience we're targeting.
const PREFERRED_GENRES = new Set([
  'country', 'rock', 'classic rock', 'pop', 'alternative', 'americana',
  'folk', 'singer-songwriter', 'indie', 'dance/electronic', 'edm',
]);
const EXCLUDED_GENRES = new Set([
  'latin', 'r&b', 'hip-hop/rap', 'hip-hop', 'rap', 'reggaeton',
  'urban contemporary', 'gospel', 'christian & gospel',
]);

function genreIsEligible(genre) {
  if (!genre) return true; // unknown genre — allow with human review
  const g = genre.toLowerCase();
  if (EXCLUDED_GENRES.has(g)) return false;
  return true;
}

// ── Golf course name heuristics ───────────────────────────────────────────────
// Mirrors isUsableGolfCourse / isLikelyPlayableCourse from verify-packages and search.
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
  if (/\bfive\s*iron\b/i.test(n)) return false;   // simulator/social golf chain
  if (/\bcity\s*golf\b/i.test(n)) return false;   // simulator chain
  if (/\bbig\s*shots?\s*golf\b/i.test(n)) return false;
  if (/\bpopstroke\b/i.test(n)) return false;
  if (/\bx-golf\b|\bxgolf\b/i.test(n)) return false;
  if (/\bputtery\b/i.test(n)) return false;          // bar/putting entertainment chain
  if (/\bbirdies\s*golf\s*lounge\b/i.test(n)) return false;
  if (/golf\s*lounge/i.test(n)) return false;
  if (/lounge.*golf|bar.*golf/i.test(n)) return false;
  return true;
}

// ── Metro city aliases ────────────────────────────────────────────────────────
// Maps venue cities that won't match golf_courses.city directly → nearest metro
// with courses. Add more here as needed.
const METRO_MAP = {
  'Landover':         'Washington',
  'East Rutherford':  'New York',
  'Foxborough':       'Boston',
  'Inglewood':        'Los Angeles',
  'Santa Clara':      'San Jose',
  'Sunrise':          'Fort Lauderdale',
  'Elmont':           'New York',
  'Uniondale':        'New York',
  'Auburn Hills':     'Detroit',
  'Commerce City':    'Denver',
  'Sandy':            'Salt Lake City',
  'Hillsboro':        'Portland',
  'Concord':          'Charlotte',
  'Bristow':          'Washington',
  'Noblesville':      'Indianapolis',
  'Tinley Park':      'Chicago',
  'Rosemont':         'Chicago',
  'Waukegan':         'Chicago',
  'Cuyahoga Falls':   'Cleveland',
  'Independence':     'Cleveland',
  'Mansfield':        'Boston',
  'Holmdel':          'New York',
  'Wantagh':          'New York',
  'Saratoga Springs': 'Albany',
  'The Woodlands':    'Houston',
  'Sugar Land':       'Houston',
  'Alpharetta':       'Atlanta',
  'Duluth':           'Atlanta',
  'Chula Vista':      'San Diego',
  'Irvine':           'Los Angeles',
  'Mountain View':    'San Jose',
  'Wheatland':        'Sacramento',
  'Clarkston':        'Detroit',
  'Burgettstown':     'Pittsburgh',
  'Hershey':          'Harrisburg',
  'Camden':           'Philadelphia',
  'Holmdel':          'New York',
  'Ridgefield':       'Portland',
  'George':           'Seattle',
  'West Palm Beach':  'Palm Beach',
  'Tampa':            'Tampa',
};

// ── Metro slug → golf_courses.city ───────────────────────────────────────────
// Converts a metro_slug like "new-york" → "New York", with overrides for slugs
// that don't map cleanly to golf_courses city values.
const SLUG_OVERRIDES = {
  'washington-dc': 'Washington',
  'new-york-city': 'New York',
  'new-york':      'New York',
  'los-angeles':   'Los Angeles',
  'san-francisco': 'San Francisco',
  'las-vegas':     'Las Vegas',
  'san-diego':     'San Diego',
  'san-antonio':   'San Antonio',
  'fort-lauderdale': 'Fort Lauderdale',
  'salt-lake-city':  'Salt Lake City',
  'kansas-city':     'Kansas City',
  'oklahoma-city':   'Oklahoma City',
  'atlantic-city':   null, // no courses nearby — skip
};

function resolveCity(metroSlug, fallbackCity) {
  if (!metroSlug) return METRO_MAP[fallbackCity] || fallbackCity;
  if (metroSlug in SLUG_OVERRIDES) return SLUG_OVERRIDES[metroSlug]; // null = skip
  return metroSlug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ── Brightness scoring ────────────────────────────────────────────────────────
async function brightness(url) {
  try {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'w=80&h=80&fit=crop', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { data } = await sharp(buf).resize(80, 80).grayscale().raw().toBuffer({ resolveWithObject: true });
    return Math.round(data.reduce((s, v) => s + v, 0) / data.length / 255 * 100);
  } catch { return null; }
}

// ── DB pool ───────────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER, password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'postgres',
  ssl: { rejectUnauthorized: false },
});

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`\n  seed-packages-from-discovery — ${DRY_RUN ? 'DRY RUN' : '⚡ CREATE MODE'}\n`);

// 1. Fetch eligible discovery shows not yet in events
const { rows: shows } = await pool.query(`
  SELECT * FROM (
    SELECT DISTINCT ON (ds.tm_event_id)
      ds.tm_event_id,
      ds.artist,
      ds.city,
      ds.metro_slug,
      ds.genre,
      ds.event_date,
      ds.image_url,
      ds.ticket_url,
      ds.score,
      ds.venue
    FROM public.discovery_shows ds
    WHERE ds.active = true
    AND ds.event_date >= CURRENT_DATE + INTERVAL '30 days'
    AND ds.event_date <= CURRENT_DATE + INTERVAL '210 days'
    AND ds.score >= 158
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
      AND LOWER(ds.genre) NOT IN (
        'latin','r&b','hip-hop/rap','hip-hop','rap','reggaeton',
        'urban contemporary','gospel','christian & gospel'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.packages p
        JOIN public.events e ON e.id = p.event_id
        WHERE e.source_id = ds.tm_event_id AND p.active = true
      )
    ORDER BY ds.tm_event_id, ds.score DESC
  ) sub
  ORDER BY score DESC
  LIMIT $1
`, [LIMIT]);

console.log(`  Found ${shows.length} discovery shows without packages.\n`);

// 2. For each show, find the best golf course in that city/metro
const results = [];

for (const show of shows) {
  const lookupCity = resolveCity(show.metro_slug, show.city);
  if (lookupCity === null) {
    results.push({ show, course: null, reason: `no golf market for metro (${show.metro_slug})` });
    continue;
  }

  const { rows: rawCourses } = await pool.query(`
    SELECT id, name, city, state, rating, marketing_image_url, image_brightness_score
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
    ORDER BY
      CASE WHEN image_brightness_score IS NOT NULL THEN image_brightness_score ELSE 100 END ASC,
      rating DESC NULLS LAST
    LIMIT 10
  `, [lookupCity]);
  const courses = rawCourses.filter(c => courseNameIsPlayable(c.name));

  if (!courses.length) {
    results.push({ show, course: null, reason: `no courses found in ${lookupCity}` });
    continue;
  }

  const course = courses[0];
  results.push({ show, course, lookupCity });
}

// 3. Report candidates
const candidates = results.filter(r => r.course);
const skipped    = results.filter(r => !r.course);

console.log(`  Candidates with golf course matches: ${candidates.length}`);
console.log(`  Skipped (no courses in city):        ${skipped.length}\n`);

if (skipped.length) {
  console.log('  Skipped shows:');
  skipped.forEach(r => console.log(`    ${r.show.artist.padEnd(26)} ${r.show.city}  — ${r.reason}`));
  console.log('');
}

console.log('  Candidates:');
candidates.forEach(r => {
  const date = new Date(r.show.event_date).toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
  console.log(`    ${r.show.artist.padEnd(26)} ${date.padEnd(14)} ${r.show.city.padEnd(18)} → ${r.course.name} (${r.course.city}, ${r.course.state})`);
});

if (DRY_RUN) {
  console.log('\n  Dry run complete. Run with --create to write to DB.\n');
  await pool.end();
  process.exit(0);
}

// 4. Create events + packages for each candidate
console.log('\n  Creating packages…\n');

let created = 0, errors = 0;

for (const { show, course, lookupCity } of candidates) {
  try {
    // 4a. Find or create artist
    let artistId;
    const { rows: existing } = await pool.query(
      `SELECT id FROM public.artists WHERE LOWER(name) = LOWER($1) LIMIT 1`, [show.artist]
    );
    if (existing.length) {
      artistId = existing[0].id;
    } else {
      const { rows: newArtist } = await pool.query(
        `INSERT INTO public.artists (name, genre) VALUES ($1, $2) RETURNING id`,
        [show.artist, show.genre || null]
      );
      artistId = newArtist[0].id;
    }

    // 4b. Score event image brightness
    let brightScore = null;
    if (show.image_url) {
      brightScore = await brightness(show.image_url);
    }

    // 4c. Find or create event
    const { rows: existEvt } = await pool.query(
      `SELECT id FROM public.events WHERE source_id = $1 LIMIT 1`, [show.tm_event_id]
    );
    let eventId;
    if (existEvt.length) {
      eventId = existEvt[0].id;
      if (brightScore != null) {
        await pool.query(`UPDATE public.events SET image_brightness_score=$1, updated_at=now() WHERE id=$2`,
          [brightScore, eventId]);
      }
    } else {
      const { rows: evtRows } = await pool.query(`
        INSERT INTO public.events
          (name, artist_id, event_date, image_url, ticket_url, source_id, source_name,
           active, image_brightness_score)
        VALUES ($1, $2, $3, $4, $5, $6, 'ticketmaster', true, $7)
        RETURNING id
      `, [
        `${show.artist} at ${show.venue || show.city}`,
        artistId, show.event_date, show.image_url, show.ticket_url,
        show.tm_event_id, brightScore,
      ]);
      eventId = evtRows[0].id;
    }

    // 4d. Create package
    const pkgName = `${show.artist} + ${course.name} | ${course.city}, ${course.state}`;
    const eventDate = new Date(show.event_date);
    const friday = new Date(eventDate);
    friday.setDate(eventDate.getDate() - ((eventDate.getDay() + 2) % 7)); // prior Friday
    const sunday = new Date(friday);
    sunday.setDate(friday.getDate() + 2);

    // Skip if a package already exists for this event + course combo
    const { rows: existPkg } = await pool.query(
      `SELECT id FROM public.packages WHERE event_id=$1 AND golf_course_id=$2 LIMIT 1`,
      [eventId, course.id]
    );
    if (existPkg.length) {
      console.log(`  ↩ Already exists: ${show.artist} + ${course.name}`);
      created++;
      continue;
    }

    await pool.query(`
      INSERT INTO public.packages
        (name, event_id, golf_course_id, city, artist_name, golf_course_name,
         event_name, event_date,
         price, original_price, category, source, active,
         save_count, verification_status, verification_fail_count,
         package_start_date, package_end_date,
         image_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, 825,975,'Golf + Concert','curated',true,
              0,'unverified',0, $9,$10,$11)
    `, [
      pkgName, eventId, course.id, course.city,
      show.artist, course.name,
      `${show.artist} at ${show.venue || show.city}`,
      show.event_date,
      friday.toISOString().slice(0,10),
      sunday.toISOString().slice(0,10),
      show.image_url,
    ]);

    const brightStr = brightScore != null ? ` (brightness ${brightScore})` : '';
    console.log(`  ✓ ${pkgName}${brightStr}`);
    created++;
  } catch (err) {
    console.error(`  ✗ ${show.artist} — ${err.message}`);
    errors++;
  }
}

console.log(`\n  Done. Created: ${created}  Errors: ${errors}\n`);
console.log('  Next: run score-golf-images.mjs and score-event-images.mjs to make new packages eligible.\n');

await pool.end();
