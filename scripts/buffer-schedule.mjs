/**
 * Buffer posting schedule helpers.
 *
 * Default behavior is to add posts to each Buffer channel's queue so Buffer uses
 * the posting schedule configured in the Buffer UI for that channel.
 */

const POST_SLOTS_CT = [
  { dow: 2, hour: 19, minute: 30 }, // Tuesday
  { dow: 4, hour: 12, minute: 15 }, // Thursday
  { dow: 6, hour: 11, minute: 30 }, // Saturday
];

const DOW_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const BUFFER_GQL = "https://api.buffer.com";

function centralParts(ms) {
  const map = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    })
      .formatToParts(new Date(ms))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return {
    year: +map.year,
    month: +map.month,
    day: +map.day,
    hour: +map.hour,
    minute: +map.minute,
    dow: DOW_MAP[map.weekday] ?? 0,
  };
}

function utcFromCentral(y, mo, d, hour, minute) {
  let utcMs = Date.UTC(y, mo - 1, d, hour + 6, minute);
  for (let i = 0; i < 4; i++) {
    const p = centralParts(utcMs);
    const diffMin =
      (hour * 60 + minute) -
      (p.hour * 60 + p.minute) +
      Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(p.year, p.month - 1, p.day)) / 86_400_000) *
        24 *
        60;
    utcMs += diffMin * 60_000;
  }
  return new Date(utcMs);
}

function addCentralDays(y, mo, d, days) {
  const p = centralParts(utcFromCentral(y, mo, d, 12, 0).getTime() + days * 86_400_000);
  return { year: p.year, month: p.month, day: p.day };
}

/** Next Instagram slot (Tue/Thu/Sat CT), at least 1 hour from now. */
export function nextPostSlot(from = new Date()) {
  const soon = from.getTime() + 60 * 60 * 1000;
  const today = centralParts(from.getTime());
  const candidates = [];

  for (let dayOffset = 0; dayOffset <= 14; dayOffset++) {
    const { year, month, day } = addCentralDays(today.year, today.month, today.day, dayOffset);
    const dow = centralParts(utcFromCentral(year, month, day, 12, 0).getTime()).dow;
    for (const slot of POST_SLOTS_CT) {
      if (slot.dow !== dow) continue;
      const at = utcFromCentral(year, month, day, slot.hour, slot.minute);
      if (at.getTime() > soon) candidates.push(at);
    }
  }

  candidates.sort((a, b) => a - b);
  return candidates[0] ?? new Date(from.getTime() + 4 * 60 * 60 * 1000);
}

/** Facebook follows Instagram: same clock time, next calendar day in Central. */
export function facebookDayAfter(instagramAt) {
  const p = centralParts(instagramAt.getTime());
  const next = addCentralDays(p.year, p.month, p.day, 1);
  return utcFromCentral(next.year, next.month, next.day, p.hour, p.minute);
}

export function formatCentralSchedule(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Schedule a carousel to one Buffer channel. */
export async function scheduleCarouselInBuffer({
  token,
  channelId,
  platform,
  slides,
  caption,
  scheduledAt = null,
}) {
  if (!token || !channelId) return null;

  const metadata =
    platform === "facebook"
      ? { facebook: { type: "post" } }
      : { instagram: { type: "post", shouldShareToFeed: true } };

  const assets = slides.map((url) => ({ image: { url } }));
  const input = {
    channelId,
    text: caption,
    assets,
    schedulingType: "automatic",
    mode: scheduledAt ? "customScheduled" : "addToQueue",
    metadata,
  };
  if (scheduledAt) input.dueAt = scheduledAt.toISOString();

  const res = await fetch(BUFFER_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query: `mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess { post { id dueAt } }
          ... on MutationError { message }
        }
      }`,
      variables: {
        input,
      },
    }),
  });

  const data = await res.json();
  const post = data?.data?.createPost?.post;
  const err = data?.data?.createPost?.message;
  if (err) throw new Error(`Buffer (${platform}): ${err}`);
  return post
    ? { id: post.id ?? null, dueAt: post.dueAt ? new Date(post.dueAt) : null }
    : null;
}

/** Add Instagram/Facebook posts to their channel queues. */
export async function scheduleInstagramAndFacebook({
  token,
  instagramChannelId,
  facebookChannelId,
  slides,
  caption,
  instagramAt = null,
  facebookAt = null,
}) {
  const instagramPost = await scheduleCarouselInBuffer({
    token,
    channelId: instagramChannelId,
    platform: "instagram",
    slides,
    caption,
    scheduledAt: instagramAt,
  });

  let facebookPost = null;
  if (facebookChannelId) {
    facebookPost = await scheduleCarouselInBuffer({
      token,
      channelId: facebookChannelId,
      platform: "facebook",
      slides,
      caption,
      scheduledAt: facebookAt,
    });
  }

  return {
    instagramAt: instagramPost?.dueAt ?? instagramAt,
    instagramId: instagramPost?.id ?? null,
    facebookAt: facebookPost?.dueAt ?? facebookAt,
    facebookId: facebookPost?.id ?? null,
  };
}
