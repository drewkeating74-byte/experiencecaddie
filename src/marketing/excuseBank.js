export const eyebrowLabels = [
  "THIS IS THE EXCUSE",
  "THE OVERDUE TRIP",
  "BEFORE ANOTHER YEAR GOES BY",
  "WEEKEND, FINALLY",
  "THE TRIP YOU KEEP TALKING ABOUT",
];

export const mainHooks = [
  "You keep saying you'll get the guys together.",
  "The older you get, the more the trip matters.",
  "Life got busy. The trip doesn't have to be.",
  "Everyone's busy. That's exactly why the weekend matters.",
  '"Someday" turns into next year fast.',
  "You don't see them enough.",
  "Another year went by. Nobody booked anything.",
  "Stop planning trips like a second job.",
  "The trip doesn't plan itself. We do.",
  "Be the guy who actually makes it happen.",
  'Don\'t let "we should" turn into "we never did."',
  "One weekend a year keeps the group together.",
];

export const supportingLines = [
  "Golf. Live music. One weekend. We'll build it in minutes.",
  "Pick the show. We'll build the golf weekend around it.",
  "Concert, golf, hotel — planned in minutes. No spreadsheet.",
  "One platform. Tee times and encores. Zero hassle.",
  "Golf by day. Live music by night. Built for the group chat.",
];

export const ctaPills = [
  "Make it happen",
  "Build the weekend",
  "Start planning",
  "Build it in minutes",
  "Pick the show",
];

export const bgImages = [
  "https://experiencecaddie.com/excuse-concert-01.jpg",
  "https://experiencecaddie.com/excuse-concert-02.jpg",
  "https://experiencecaddie.com/excuse-concert-03.jpg",
  "https://experiencecaddie.com/excuse-concert-golf-02.jpg",
  "https://experiencecaddie.com/excuse-golf-01.jpg",
  "https://experiencecaddie.com/excuse-golf-04.jpg",
  "https://experiencecaddie.com/excuse-golf-05.jpg",
];

export const excuseCaptions = [
  [
    'Every year the calendar fills up and the trip you keep talking about slips to "next year." This is the excuse to stop talking about it. 🏌️‍♂️🎸',
    "",
    "Golf, live music, hotel — we build the whole weekend in minutes. You just pick the show.",
    "",
    "Tag the friend you keep saying you'll do this with. 👇",
    "",
    "#guystrip #golftrip #golfweekend #livemusic #weekendtrip #oldfriends #experiencecaddie #fairwaysandencores",
  ].join("\n"),

  [
    "You don't see the crew enough. Everyone's busy — that's exactly why the weekend matters. ⛳🎶",
    "",
    "Experience Caddie builds golf + concert weekends in minutes. No 12 open tabs, no spreadsheet, no \"who's booking the hotel.\"",
    "",
    "Send this to the group chat. 👇",
    "",
    "#guysweekend #golftravel #livemusic #golftrip #weekendgetaway #experiencecaddie #fairwaysandencores",
  ].join("\n"),
];

export const WEBSITE_URL = "experiencecaddie.com";

export function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("pickRandom requires a non-empty array");
  }

  return arr[Math.floor(Math.random() * arr.length)];
}

let pendingExcusePost = null;

export function buildExcusePost() {
  const eyebrowLabel = pickRandom(eyebrowLabels);
  const mainHook = pickRandom(mainHooks);
  const supportingLine = pickRandom(supportingLines);
  const ctaPill = pickRandom(ctaPills);
  const bgImage = pickRandom(bgImages);
  const caption = pickRandom(excuseCaptions);

  return {
    variantKey: mainHook,
    label: mainHook,
    selection: {
      eyebrowLabel,
      mainHook,
      supportingLine,
      ctaPill,
      bgImage,
    },
    modifications: [
      { name: "bg_image", image_url: bgImage },
      { name: "eyebrow_label", text: eyebrowLabel },
      { name: "main_hook", text: mainHook },
      { name: "supporting_line", text: supportingLine },
      { name: "cta_pill", text: ctaPill },
      { name: "website_url", text: WEBSITE_URL },
    ],
    caption,
  };
}

function getPendingExcusePost(part) {
  if (!pendingExcusePost || pendingExcusePost[part]) {
    pendingExcusePost = {
      post: buildExcusePost(),
      modifications: false,
      caption: false,
    };
  }

  pendingExcusePost[part] = true;
  const post = pendingExcusePost.post;

  if (pendingExcusePost.modifications && pendingExcusePost.caption) {
    pendingExcusePost = null;
  }

  return post;
}

export function buildExcuseModifications() {
  return getPendingExcusePost("modifications").modifications;
}

export function buildExcuseCaption() {
  return getPendingExcusePost("caption").caption;
}
