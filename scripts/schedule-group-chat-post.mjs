/**
 * Render and schedule one Group Chat Screenshot post via Bannerbear + Buffer.
 *
 * Usage:
 *   node --env-file=.env scripts/schedule-group-chat-post.mjs --dry-run
 *   node --env-file=.env scripts/schedule-group-chat-post.mjs
 */

import {
  buildGroupChatCaption,
  buildGroupChatModifications,
} from "../src/marketing/groupChatBank.js";
import {
  facebookDayAfter,
  formatCentralSchedule,
  nextPostSlot,
  scheduleInstagramAndFacebook,
} from "./buffer-schedule.mjs";

const BB_KEY = process.env.BANNERBEAR_API_KEY;
const BUFFER_TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const BUFFER_CHAN = process.env.BUFFER_CHANNEL_ID;
const BUFFER_FB_CHAN = process.env.BUFFER_FACEBOOK_CHANNEL_ID;
const BB_GROUP_CHAT_TEMPLATE = "ok0l2K5mM9Lv53j1Yx";
const DRY_RUN = process.argv.includes("--dry-run");

async function renderGroupChatPost() {
  if (!BB_KEY) throw new Error("BANNERBEAR_API_KEY is not set");

  const createRes = await fetch("https://sync.api.bannerbear.com/v2/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template: BB_GROUP_CHAT_TEMPLATE,
      modifications: buildGroupChatModifications(),
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
  const caption = buildGroupChatCaption();
  const instagramAt = nextPostSlot();
  const facebookAt = BUFFER_FB_CHAN ? facebookDayAfter(instagramAt) : null;

  if (DRY_RUN) {
    console.log("Group Chat schedule dry run");
    console.log(`Instagram: ${formatCentralSchedule(instagramAt)} CT`);
    if (facebookAt) {
      console.log(`Facebook:  ${formatCentralSchedule(facebookAt)} CT (+1 day)`);
    }
    console.log(`Caption:\n${caption.split("\n").map((line) => `  ${line}`).join("\n")}`);
    console.log("[DRY RUN - no Bannerbear or Buffer calls made]");
    return;
  }

  requireEnv();

  const render = await renderGroupChatPost();
  if (!render.image_url) {
    throw new Error(`Bannerbear did not return an image_url for ${render.uid}`);
  }

  console.log(`Rendered Group Chat image: ${render.image_url}`);

  const result = await scheduleInstagramAndFacebook({
    token: BUFFER_TOKEN,
    instagramChannelId: BUFFER_CHAN,
    facebookChannelId: BUFFER_FB_CHAN || null,
    slides: [render.image_url],
    caption,
  });

  console.log(`Instagram: ${formatCentralSchedule(result.instagramAt)} CT - Buffer ${result.instagramId}`);
  if (result.facebookId) {
    console.log(`Facebook:  ${formatCentralSchedule(result.facebookAt)} CT - Buffer ${result.facebookId}`);
  }
  console.log("Review at buffer.com/calendar before it goes live.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
