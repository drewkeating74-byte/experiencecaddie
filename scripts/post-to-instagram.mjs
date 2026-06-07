/**
 * post-to-instagram.mjs
 *
 * Posts pending instagram_queue rows to Instagram via Buffer's API.
 * Each post is scheduled a few hours ahead so you can review + cancel
 * in the Buffer dashboard before it goes live.
 *
 * Usage:
 *   node --env-file=.env scripts/post-to-instagram.mjs [--dry-run] [--now]
 *
 *   --dry-run   Preview what would be posted without calling Buffer or DB
 *   --now       Schedule for 30 minutes from now instead of the default offset
 *
 * Required env vars:
 *   BUFFER_ACCESS_TOKEN       Your Buffer OAuth access token
 *   BUFFER_PROFILE_ID         Your Instagram profile ID in Buffer
 *                             (find it by running with --list-profiles)
 *
 * Optional:
 *   SCHEDULE_OFFSET_HOURS     Hours ahead to schedule (default: 4)
 *
 * Setup:
 *   1. Create Buffer account at buffer.com, connect Instagram
 *   2. Create a Buffer app at buffer.com/developers/apps
 *   3. Run: node --env-file=.env scripts/refresh-buffer-token.mjs --code=<auth_code>
 *   4. Find your profile ID: node --env-file=.env scripts/post-to-instagram.mjs --list-profiles
 *   5. Add BUFFER_PROFILE_ID to .env
 */

import pg from 'pg';

const pool = new pg.Pool();

const ACCESS_TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const PROFILE_ID   = process.env.BUFFER_PROFILE_ID;
const OFFSET_HOURS = parseInt(process.env.SCHEDULE_OFFSET_HOURS ?? '4', 10);
const BASE         = 'https://api.bufferapp.com/1';

const DRY_RUN       = process.argv.includes('--dry-run');
const POST_SOON     = process.argv.includes('--now');
const LIST_PROFILES = process.argv.includes('--list-profiles');

// ── Helpers ───────────────────────────────────────────────────────────────────

function checkEnv() {
  const missing = [];
  if (!ACCESS_TOKEN) missing.push('BUFFER_ACCESS_TOKEN');
  if (!PROFILE_ID && !LIST_PROFILES) missing.push('BUFFER_PROFILE_ID');
  if (missing.length) {
    console.error(`\n  Missing env vars: ${missing.join(', ')}`);
    console.error(`  Add them to .env and to GitHub Actions secrets.\n`);
    process.exit(1);
  }
}

async function bufferGet(path) {
  const url = `${BASE}${path}?access_token=${ACCESS_TOKEN}`;
  const res  = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function bufferPost(path, params) {
  const body = new URLSearchParams({ access_token: ACCESS_TOKEN, ...params });
  const res  = await fetch(`${BASE}${path}`, { method: 'POST', body });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(JSON.stringify(data));
  return data;
}

// ── List connected profiles ───────────────────────────────────────────────────
async function listProfiles() {
  const profiles = await bufferGet('/profiles.json');
  console.log('\n  Buffer connected profiles:\n');
  profiles.forEach(p => {
    console.log(`  ${p.service.padEnd(14)} ${p.service_username.padEnd(30)} ID: ${p.id}`);
  });
  console.log('\n  Add BUFFER_PROFILE_ID=<id> to your .env\n');
}

// ── Build caption ─────────────────────────────────────────────────────────────
function buildCaption(row) {
  const artist = row.artist_name    || '';
  const course = row.golf_course_name || '';
  const city   = row.city           || '';
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

  // List profiles mode
  if (LIST_PROFILES) {
    await listProfiles();
    await pool.end();
    return;
  }

  // Fetch pending rows
  const { rows: queue } = await pool.query(`
    SELECT
      iq.id            AS queue_id,
      iq.hook_slide_url,
      iq.golf_slide_url,
      iq.concert_slide_url,
      iq.cta_slide_url,
      p.name           AS package_name,
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

  // Schedule time
  const scheduledAt = new Date();
  scheduledAt.setMinutes(POST_SOON ? scheduledAt.getMinutes() + 30 : scheduledAt.getHours() + OFFSET_HOURS * 60);
  if (!POST_SOON) {
    scheduledAt.setHours(scheduledAt.getHours() + OFFSET_HOURS);
    scheduledAt.setMinutes(0, 0, 0);
  }

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

    console.log(`  Package:   ${row.package_name}`);
    console.log(`  Slides:    ${slides.length}`);
    console.log(`  Scheduled: ${scheduledAt.toLocaleString()}`);

    if (DRY_RUN) {
      console.log(`  Caption:\n${caption.split('\n').map(l => '    ' + l).join('\n')}`);
      console.log(`  Slide URLs:`);
      slides.forEach((u, i) => console.log(`    ${i + 1}. ${u}`));
      console.log(`  [DRY RUN — no API calls made]\n`);
      continue;
    }

    try {
      // Buffer carousel: pass each photo URL as media[photo_urls][]
      // For Instagram carousels Buffer uses multiple photo_urls
      const params = {
        'profile_ids[]':          PROFILE_ID,
        'text':                   caption,
        'scheduled_at':           scheduledAt.toISOString(),
      };

      // Add each slide as a carousel image
      slides.forEach((url, i) => {
        params[`media[photo_urls][${i}]`] = url;
      });

      // Set carousel type
      params['media[media_type]'] = 'carousel';

      const result = await bufferPost('/updates/create.json', params);

      console.log(`  Buffer update ID: ${result.updates?.[0]?.id ?? result.id}`);
      console.log(`  → Review at buffer.com/app before it posts\n`);

      // Update queue status
      await pool.query(
        `UPDATE public.instagram_queue SET status='scheduled', posted_at=$1 WHERE id=$2`,
        [scheduledAt, row.queue_id]
      );

    } catch (err) {
      console.error(`  ERROR for ${row.package_name}: ${err.message}\n`);
    }
  }

  await pool.end();
  console.log('  Done.\n');
}

main();
