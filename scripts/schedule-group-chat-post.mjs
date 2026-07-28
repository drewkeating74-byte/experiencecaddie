/**
 * Render and schedule one Group Chat Screenshot post via Bannerbear + Buffer.
 *
 * Usage:
 *   node --env-file=.env scripts/schedule-group-chat-post.mjs --dry-run
 *   node --env-file=.env scripts/schedule-group-chat-post.mjs
 */

import { buildGroupChatPost } from "../src/marketing/groupChatBank.js";
import { recordSocialUsage } from "../src/marketing/recordSocialUsage.js";
import {
  formatCentralSchedule,
  scheduleInstagramAndFacebook,
} from "./buffer-schedule.mjs";

const BB_KEY = process.env.BANNERBEAR_API_KEY;
const BUFFER_TOKEN = process.env.BUFFER_ACCESS_TOKEN;
const BUFFER_CHAN = process.env.BUFFER_CHANNEL_ID;
const BUFFER_FB_CHAN = process.env.BUFFER_FACEBOOK_CHANNEL_ID;
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BB_GROUP_CHAT_TEMPLATE = "ok0l2K5mM9Lv53j1Yx";
const DRY_RUN = process.argv.includes("--dry-run");

async function renderGroupChatPost(draft) {
  if (!BB_KEY) throw new Error("BANNERBEAR_API_KEY is not set");

  const createRes = await fetch("https://sync.api.bannerbear.com/v2/images", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BB_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template: BB_GROUP_CHAT_TEMPLATE,
      modifications: draft.modifications,
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
  const draft = buildGroupChatPost();

  if (DRY_RUN) {
    console.log("Group Chat schedule dry run");
    console.log(`Variant: ${draft.label} (${draft.variantKey})`);
    console.log("Instagram: next available Buffer queue slot");
    if (BUFFER_FB_CHAN) console.log("Facebook:  next available Buffer queue slot");
    console.log(`Caption:\n${draft.caption.split("\n").map((line) => `  ${line}`).join("\n")}`);
    console.log("[DRY RUN - no Bannerbear or Buffer calls made]");
    return;
  }

  requireEnv();

  const render = await renderGroupChatPost(draft);
  if (!render.image_url) {
    throw new Error(`Bannerbear did not return an image_url for ${render.uid}`);
  }

  console.log(`Rendered Group Chat image: ${render.image_url}`);

  const result = await scheduleInstagramAndFacebook({
    token: BUFFER_TOKEN,
    instagramChannelId: BUFFER_CHAN,
    facebookChannelId: BUFFER_FB_CHAN || null,
    slides: [render.image_url],
    caption: draft.caption,
  });

  if (SUPABASE_URL && SERVICE_KEY) {
    await recordSocialUsage({
      supabaseUrl: SUPABASE_URL,
      serviceKey: SERVICE_KEY,
      templateType: "group_chat",
      variantKey: draft.variantKey,
      label: draft.label,
      imageUrl: render.image_url,
      caption: draft.caption,
      bufferPostId: result.instagramId,
      usedAt: result.instagramAt || new Date(),
      metadata: { facebookBufferId: result.facebookId, source: "schedule-group-chat-post" },
    });
  }

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
