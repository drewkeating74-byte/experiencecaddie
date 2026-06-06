/**
 * post-to-instagram.mjs
 *
 * Posts pending instagram_queue rows as scheduled Instagram carousel posts.
 * Each post is scheduled 4 hours ahead so you can preview + cancel in
 * Meta Business Suite before it goes live.
 *
 * Usage:
 *   node --env-file=.env scripts/post-to-instagram.mjs [--dry-run] [--now]
 *
 *   --dry-run   Preview what would be posted without calling Instagram or DB
 *   --now       Publish immediately instead of scheduling 4 hours ahead
 *
 * Required env vars:
 *   META_ACCESS_TOKEN            Long-lived Page access token (60 days)
 *   INSTAGRAM_BUSINESS_ACCOUNT_ID  Numeric IG account ID (e.g. 17604144370103029)
 *
 * Optional:
 *   DATABASE_URL or PG* vars (same as other scripts)
 *
 * How it works (Instagram Graph API carousel flow):
 *   1. Upload each slide as a child media container (image_url → IG CDN)
 *   2. Create a carousel container referencing the child IDs
 *   3. Publish (or schedule) the carousel container
 *   4. Update instagram_queue row to status='scheduled' or 'posted'
 */

import pg from 'pg';

const pool = new pg.Pool();

const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const IG_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const BASE = `https://graph.facebook.com/v21.0`;

const DRY_RUN = process.argv.includes('--dry-run');
const POST_NOW = process.argv.includes('--now');
// Schedule 4 hours ahead by default so you can review in Meta Business Suite
const SCHEDULE_OFFSET_HOURS = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

function checkEnv() {
  const missing = [];
  if (!ACCESS_TOKEN) missing.push('META_ACCESS_TOKEN');
  if (!IG_ACCOUNT_ID) missing.push('INSTAGRAM_BUSINESS_ACCOUNT_ID');
  if (missing.length) {
    console.error(`\n  Missing env vars: ${missing.join(', ')}`);
    console.error(`  Add them to .env and to GitHub Actions secrets.\n`);
    process.exit(1);
  }
}

async function igPost(path, body) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: ACCESS_TOKEN }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `HTTP ${res.status} from ${path}`);
  }
  return data;
}

// ── Step 1: Create a child media container for one slide ──────────────────────
async function createChildContainer(imageUrl) {
  const data = await igPost(`/${IG_ACCOUNT_ID}/media`, {
    image_url: imageUrl,
    is_carousel_item: true,
  });
  return data.id; // child container ID
}

// ── Step 2: Create the carousel container ─────────────────────────────────────
async function createCarouselContainer(childIds, caption, scheduledTime) {
  const body = {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
  };
  if (scheduledTime) {
    body.scheduled_publish_time = Math.floor(scheduledTime.getTime() / 1000);
    body.published = false;
  } else {
    body.published = false; // will publish in step 3
  }
  const data = await igPost(`/${IG_ACCOUNT_ID}/media`, body);
  return data.id; // carousel container ID
}

// ── Step 3: Publish the carousel ──────────────────────────────────────────────
async function publishCarousel(carouselId) {
  const data = await igPost(`/${IG_ACCOUNT_ID}/media_publish`, {
    creation_id: carouselId,
  });
  return data.id; // published media ID
}

// ── Build caption from package info ───────────────────────────────────────────
function buildCaption(row) {
  const artist = row.artist_name || '';
  const course = row.golf_course_name || '';
  const city   = row.city || '';
  const date   = row.event_date_fmt || '';

  return [
    `🎸⛳ ${artist} + a round of golf in ${city}`,
    ``,
    `${artist} is playing ${city} on ${date}. Make a weekend of it — tee off at ${course} and catch the show that night.`,
    ``,
    `🔗 Build your package at experiencecaddie.com`,
    ``,
    `#golf #concert #golfweekend #${artist.toLowerCase().replace(/[^a-z0-9]/g, '')} #experiencecaddie #guysweekend #golftrip`,
  ].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!DRY_RUN) checkEnv();

  // Fetch pending rows joined with package info
  const { rows: queue } = await pool.query(`
    SELECT
      iq.id          AS queue_id,
      iq.hook_slide_url,
      iq.golf_slide_url,
      iq.concert_slide_url,
      iq.cta_slide_url,
      p.name         AS package_name,
      p.artist_name,
      p.golf_course_name,
      p.city,
      to_char(e.event_date, 'Mon DD, YYYY') AS event_date_fmt
    FROM public.instagram_queue iq
    JOIN public.packages p ON p.id = iq.package_id
    JOIN public.events   e ON e.id = p.event_id
    WHERE iq.status = 'pending'
    ORDER BY iq.created_at ASC
    LIMIT 5
  `);

  if (!queue.length) {
    console.log('\n  No pending posts in instagram_queue.\n');
    await pool.end();
    return;
  }

  console.log(`\n  Found ${queue.length} pending post(s).\n`);

  const scheduledTime = POST_NOW ? null : (() => {
    const t = new Date();
    t.setHours(t.getHours() + SCHEDULE_OFFSET_HOURS);
    return t;
  })();

  for (const row of queue) {
    const slides = [
      row.hook_slide_url,
      row.golf_slide_url,
      row.concert_slide_url,
      row.cta_slide_url,
    ].filter(Boolean);

    if (slides.length < 2) {
      console.warn(`  SKIP ${row.package_name} — fewer than 2 slide URLs`);
      continue;
    }

    const caption = buildCaption(row);

    console.log(`  Package: ${row.package_name}`);
    console.log(`  Slides:  ${slides.length}`);
    console.log(`  Mode:    ${POST_NOW ? 'publish immediately' : `schedule for ${scheduledTime.toLocaleString()}`}`);
    if (DRY_RUN) {
      console.log(`  Caption:\n${caption.split('\n').map(l => '    ' + l).join('\n')}`);
      console.log(`  [DRY RUN — no API calls made]\n`);
      continue;
    }

    try {
      // 1. Upload each slide as a child container
      console.log(`  Uploading ${slides.length} child containers...`);
      const childIds = [];
      for (const url of slides) {
        const id = await createChildContainer(url);
        childIds.push(id);
        process.stdout.write('    .');
      }
      console.log(' done');

      // 2. Create the carousel container
      const carouselId = await createCarouselContainer(childIds, caption, scheduledTime);
      console.log(`  Carousel container: ${carouselId}`);

      // 3. Publish or schedule
      let publishedId = null;
      if (POST_NOW) {
        publishedId = await publishCarousel(carouselId);
        console.log(`  Published! Media ID: ${publishedId}`);
      } else {
        console.log(`  Scheduled for ${scheduledTime.toLocaleString()} — review in Meta Business Suite`);
      }

      // 4. Update queue status
      const newStatus = POST_NOW ? 'posted' : 'scheduled';
      await pool.query(
        `UPDATE public.instagram_queue
         SET status = $1, posted_at = $2
         WHERE id = $3`,
        [newStatus, POST_NOW ? new Date() : scheduledTime, row.queue_id]
      );
      console.log(`  Queue status → ${newStatus}\n`);

    } catch (err) {
      console.error(`  ERROR for ${row.package_name}: ${err.message}\n`);
    }
  }

  await pool.end();
  console.log('  Done.\n');
}

main();
