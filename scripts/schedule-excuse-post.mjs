/**
 * Render and schedule one Excuse post via Bannerbear + Buffer.
 *
 * Usage:
 *   node --env-file=.env scripts/schedule-excuse-post.mjs --dry-run
 *   node --env-file=.env scripts/schedule-excuse-post.mjs
 */

import {
  buildExcuseCaption,
  buildExcuseModifications,
} from "../src/marketing/excuseBank.js";
import {
  formatCentralSchedule,
  scheduleInstagramAndFacebook,
} from "./buffer-schedule.mjs";

const BB_KEY = process.env.BANNERBEAR_API_KEY;
const BUFFER_TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const BUFFER_CHAN = process.env.BUFFER_CHANNEL_ID;
const BUFFER_FB_CHAN = process.env.BUFFER_FACEBOOK_CHANNEL_ID;
const BB_EXCUSE_TEMPLATE = "wvgMNmDoE6dnZyARK0";
const DRY_RUN = process.argv.includes("--dry-run");

async function renderExcusePost() {
  if (!BB_KEY) throw new Error("BANNERBEAR_API_KEY is not set");

  const createRes = await fetch("https://sync.api.bannerbear.com/v2/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template: BB_EXCUSE_TEMPLATE,
      modifications: buildExcuseModifications(),
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`BannerBear ${createRes.status}: ${body.slice(0, 300)}`);
  }

  const result = await createRes.json();
  return {
    uid: result.uid,
    image_url: result.image_url ?? null,
  };
}

function requireEnv() {
  const missing = [];
  if (!BB_KEY) missing.push("BANNERBEAR_API_KEY");
  if (!BUFFER_TOKEN) missing.push("BUFFER_ACCESS_TOKEN");
  if (!BUFFER_CHAN) missing.push("BUFFER_CHANNEL_ID");

  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}

async function main() {
  const caption = buildExcuseCaption();

  if (DRY_RUN) {
    console.log("Excuse schedule dry run");
    console.log("Instagram: next available Buffer queue slot");
    if (BUFFER_FB_CHAN) console.log("Facebook:  next available Buffer queue slot");
    console.log(`Caption:\n${caption.split("\n").map((line) => `  ${line}`).join("\n")}`);
    console.log("[DRY RUN - no Bannerbear or Buffer calls made]");
    return;
  }

  requireEnv();

  const render = await renderExcusePost();
  if (!render.image_url) {
    throw new Error(`Bannerbear did not return an image_url for ${render.uid}`);
  }

  console.log(`Rendered Excuse image: ${render.image_url}`);

  const result = await scheduleInstagramAndFacebook({
    token: BUFFER_TOKEN,
    instagramChannelId: BUFFER_CHAN,
    facebookChannelId: BUFFER_FB_CHAN || null,
    slides: [render.image_url],
    caption,
  });

  const igWhen = result.instagramAt
    ? `${formatCentralSchedule(result.instagramAt)} CT`
    : "Buffer queue";
  console.log(`Instagram: ${igWhen} - Buffer ${result.instagramId}`);
  if (result.facebookId) {
    const fbWhen = result.facebookAt
      ? `${formatCentralSchedule(result.facebookAt)} CT`
      : "Buffer queue";
    console.log(`Facebook:  ${fbWhen} - Buffer ${result.facebookId}`);
  }
  console.log("Review at buffer.com/calendar before it goes live.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
