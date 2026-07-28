/**
 * post-to-instagram.mjs
 *
 * Posts pending instagram_queue rows to Instagram via Buffer's GraphQL API.
 * Posts are added to each Buffer channel queue so Buffer uses the posting
 * schedule configured in the Buffer dashboard.
 *
 * Usage:
 *   node --env-file=.env scripts/post-to-instagram.mjs [--dry-run] [--now]
 *
 *   --dry-run         Preview without calling Buffer or writing to DB
 *   --now             Schedule 30 minutes from now instead of adding to queue
 *   --list-channels   Print your Buffer channel IDs and exit
 *
 * Required env vars:
 *   BUFFER_ACCESS_TOKEN   Personal API key from buffer.com/settings/api
 *   BUFFER_CHANNEL_ID     Your Instagram channel ID in Buffer
 * Optional:
 *   BUFFER_FACEBOOK_CHANNEL_ID  Facebook Page channel (scheduled +1 day after IG)
 */

import pg from 'pg';
import {
  facebookDayAfter,
  formatCentralSchedule,
  scheduleCarouselInBuffer,
  scheduleInstagramAndFacebook,
} from './buffer-schedule.mjs';

const pool = new pg.Pool();

const ACCESS_TOKEN  = process.env.BUFFER_ACCESS_TOKEN;
const CHANNEL_ID    = process.env.BUFFER_CHANNEL_ID;
const FB_CHANNEL_ID = process.env.BUFFER_FACEBOOK_CHANNEL_ID;
const GQL_URL       = 'https://api.buffer.com';

const DRY_RUN        = process.argv.includes('--dry-run');
const POST_SOON      = process.argv.includes('--now');
const LIST_CHANNELS  = process.argv.includes('--list-channels');

// ── GraphQL helper ────────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data;
}

// ── List channels ─────────────────────────────────────────────────────────────
async function listChannels() {
  // 1. Get organization ID
  const acct = await gql(`query { account { organizations { id name } } }`);
  const org  = acct.account?.organizations?.[0];
  if (!org) { console.error('  No organization found.'); return; }
  console.log(`\n  Organization: ${org.name} (${org.id})`);

  // 2. Get channels for that org
  const chData = await gql(
    `query($orgId: OrganizationId!) { channels(input: { organizationId: $orgId }) { id name service } }`,
    { orgId: org.id }
  );
  const channels = chData.channels ?? [];

  console.log('\n  Buffer connected channels:\n');
  if (!channels.length) {
    console.log('  No channels returned.');
    return;
  }
  channels.forEach(c => {
    console.log(`  ${(c.service||'').padEnd(14)} @${(c.serviceUsername || c.name || '').padEnd(30)} ID: ${c.id}`);
  });
  console.log('\n  Add BUFFER_CHANNEL_ID=<id> to your .env');
  if (FB_CHANNEL_ID) console.log('  (Facebook +1 day uses BUFFER_FACEBOOK_CHANNEL_ID)\n');
  else console.log('  Optional: BUFFER_FACEBOOK_CHANNEL_ID for Facebook +1 day\n');
}

// ── Build caption ─────────────────────────────────────────────────────────────
function buildCaption(row) {
  const artist = row.artist_name      || '';
  const course = row.golf_course_name || '';
  const city   = row.city             || '';
  const date   = row.event_date_fmt   || '';

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

// ── Check env ─────────────────────────────────────────────────────────────────
function checkEnv() {
  const missing = [];
  if (!ACCESS_TOKEN) missing.push('BUFFER_ACCESS_TOKEN');
  if (!CHANNEL_ID && !LIST_CHANNELS) missing.push('BUFFER_CHANNEL_ID');
  if (missing.length) {
    console.error(`\n  Missing env vars: ${missing.join(', ')}`);
    console.error(`  Add them to .env and to GitHub Actions secrets.\n`);
    process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!DRY_RUN) checkEnv();

  if (LIST_CHANNELS) {
    await listChannels();
    await pool.end();
    return;
  }

  // Fetch pending rows
  const { rows: queue } = await pool.query(`
    SELECT
      iq.id              AS queue_id,
      iq.hook_slide_url,
      iq.golf_slide_url,
      iq.concert_slide_url,
      iq.cta_slide_url,
      p.name             AS package_name,
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

  // Scheduled time — Buffer queue schedule by default; --now uses a custom time.
  let scheduledAt;
  let facebookScheduledAt = null;

  for (const row of queue) {
    // Carousel order: Hook → Concert → Golf → CTA
    const slides = [
      row.hook_slide_url,
      row.concert_slide_url,
      row.golf_slide_url,
      row.cta_slide_url,
    ].filter(Boolean);

    if (slides.length < 2) {
      console.warn(`  SKIP ${row.package_name} — fewer than 2 slide URLs`);
      continue;
    }

    const caption = buildCaption(row);

    console.log(`  Package:   ${row.package_name}`);
    console.log(`  Slides:    ${slides.length}`);

    if (DRY_RUN) {
      if (!POST_SOON) {
        scheduledAt = null;
        facebookScheduledAt = null;
      } else {
        scheduledAt = new Date(Date.now() + 30 * 60_000);
        facebookScheduledAt = FB_CHANNEL_ID
          ? new Date(scheduledAt.getTime() + 86_400_000)
          : null;
      }
      if (!POST_SOON) {
        console.log(`  Instagram: next available Buffer queue slot`);
        if (FB_CHANNEL_ID) console.log(`  Facebook:  next available Buffer queue slot`);
      } else {
        console.log(`  Instagram: ${formatCentralSchedule(scheduledAt)} CT`);
      }
      if (POST_SOON && facebookScheduledAt) {
        console.log(`  Facebook:  ${formatCentralSchedule(facebookScheduledAt)} CT (+1 day)`);
      }
      console.log(`  Caption:\n${caption.split('\n').map(l => '    ' + l).join('\n')}`);
      console.log(`  Slides:`);
      slides.forEach((u, i) => console.log(`    ${i + 1}. ${u}`));
      console.log(`  [DRY RUN — no API calls made]\n`);
      continue;
    }

    try {
      if (POST_SOON) {
        scheduledAt = new Date(Date.now() + 30 * 60_000);
        const igPost = await scheduleCarouselInBuffer({
          token: ACCESS_TOKEN,
          channelId: CHANNEL_ID,
          platform: 'instagram',
          slides,
          caption,
          scheduledAt,
        });
        console.log(`  Instagram: ${formatCentralSchedule(scheduledAt)} CT — Buffer ${igPost?.id ?? 'unknown'}`);
        if (FB_CHANNEL_ID) {
          facebookScheduledAt = facebookDayAfter(scheduledAt);
          const fbPost = await scheduleCarouselInBuffer({
            token: ACCESS_TOKEN,
            channelId: FB_CHANNEL_ID,
            platform: 'facebook',
            slides,
            caption,
            scheduledAt: facebookScheduledAt,
          });
          console.log(`  Facebook:  ${formatCentralSchedule(facebookScheduledAt)} CT — Buffer ${fbPost?.id ?? 'unknown'}`);
        }
      } else {
        const result = await scheduleInstagramAndFacebook({
          token: ACCESS_TOKEN,
          instagramChannelId: CHANNEL_ID,
          facebookChannelId: FB_CHANNEL_ID || null,
          slides,
          caption,
        });
        scheduledAt = result.instagramAt;
        facebookScheduledAt = result.facebookAt;
        const igWhen = scheduledAt
          ? `${formatCentralSchedule(scheduledAt)} CT`
          : "Buffer queue";
        console.log(`  Instagram: ${igWhen} — Buffer ${result.instagramId}`);
        if (result.facebookId) {
          const fbWhen = facebookScheduledAt
            ? `${formatCentralSchedule(facebookScheduledAt)} CT`
            : "Buffer queue";
          console.log(`  Facebook:  ${fbWhen} — Buffer ${result.facebookId}`);
        }
      }
      console.log(`  → Review at buffer.com/calendar before they go live\n`);

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
