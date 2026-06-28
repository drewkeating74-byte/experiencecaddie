export const chatHeaders = [
  "The Group Chat",
  "Guys Trip 🏌️",
  "Boys Weekend",
  "The Annual Trip Chat",
];

export const eyebrowLabels = [
  "SAVED YOU A PLANNING SPIRAL",
  "THE GROUP CHAT, SOLVED",
  "NOBODY HAD TO PLAN IT",
  "THIS IS HOW THE TRIP HAPPENS",
  "FOR THE CHAT THAT NEVER BOOKS ANYTHING",
];

export const chatSets = [
  {
    line1: "We need a trip.",
    line2: "Golf?",
    line3: "Concert too?",
    line4: "Who's planning it??",
    brandReply: "Already built. ✓",
  },
  {
    line1: "We should get the guys together.",
    line2: "Where though?",
    line3: "And when?",
    line4: "Who's booking hotels 😅",
    brandReply: "Say less.",
  },
  {
    line1: "It's been like 2 years.",
    line2: "We always say this.",
    line3: "Someone pick a city.",
    line4: "...anyone?",
    brandReply: "Done. Pick the show.",
  },
  {
    line1: "Bachelor trip ideas?",
    line2: "Golf for sure.",
    line3: "A show that night?",
    line4: "Who's organizing all this 🫠",
    brandReply: "We got it. ✓",
  },
  {
    line1: "Miss you guys.",
    line2: "We need a weekend.",
    line3: "Golf + a concert?",
    line4: "Cool who's planning 👀",
    brandReply: "Already built.",
  },
  {
    line1: "Turning 40 this year.",
    line2: "Trip instead of a party?",
    line3: "Golf + a show 🍻",
    line4: "Who's gonna build it though",
    brandReply: "Already did.",
  },
  {
    line1: "New baby = I'm off the grid.",
    line2: "One weekend. Just the guys.",
    line3: "Golf Saturday, concert that night?",
    line4: "I have zero hours to plan this",
    brandReply: "You don't have to.",
  },
  {
    line1: "Reunion trip?? It's been forever.",
    line2: "Same group, same city?",
    line3: "Tee time + live music?",
    line4: "Nobody volunteer at once 🙃",
    brandReply: "Handled.",
  },
  {
    line1: "The annual trip didn't happen again.",
    line2: "We literally do this every year.",
    line3: "Let's actually book it.",
    line4: "Who's making it real this time",
    brandReply: "We are. ✓",
  },
];

export const replyTitles = [
  "Golf + Concert Weekends",
  "Your Next Guys' Trip",
  "The Trip, Built",
  "Golf + Live Music Weekend",
  "One Weekend. Done.",
];

export const groupChatCaptions = [
  [
    "Every group chat has the guy who says \"we should do a trip.\" Be the guy who actually does it. 🏌️‍♂️🎸",
    "",
    "Pick the show. We'll build the golf weekend — hotel, tee time, and concert in one plan, in minutes.",
    "",
    "Tag the friend who needs to see this. 👇",
    "",
    "#golftrip #guystrip #golfweekend #livemusic #weekendtrip #golflife #bucketlisttrip #roadtrip #concertweekend #golfsquad #fairwaysandencores #experiencecaddie",
  ].join("\n"),
  [
    "Five years of \"we should get the guys together.\" Zero trips booked. Sound familiar? 😅",
    "",
    "We build golf + concert weekends in minutes — you just pick the show.",
    "",
    "Send this to the chat that never books anything. 👇",
    "",
    "#guysweekend #golftravel #livemusic #golftrip #weekendgetaway #thegroupchat #golfsquad #experiencecaddie #fairwaysandencores",
  ].join("\n"),
];

export const REPLY_URL = "experiencecaddie.com";
export const CARD_IMAGE_URL = "https://experiencecaddie.com/hero-image.jpg";

export function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("pickRandom requires a non-empty array");
  }

  return arr[Math.floor(Math.random() * arr.length)];
}

export function buildGroupChatModifications() {
  const chatSet = pickRandom(chatSets);

  return [
    { name: "chat_header", text: pickRandom(chatHeaders) },
    { name: "eyebrow_label", text: pickRandom(eyebrowLabels) },
    { name: "chat_line_1", text: chatSet.line1 },
    { name: "chat_line_2", text: chatSet.line2 },
    { name: "chat_line_3", text: chatSet.line3 },
    { name: "chat_line_4", text: chatSet.line4 },
    { name: "reply_image", image_url: CARD_IMAGE_URL },
    { name: "reply_title", text: pickRandom(replyTitles) },
    { name: "reply_url", text: REPLY_URL },
    { name: "brand_reply", text: chatSet.brandReply },
  ];
}

export function buildGroupChatCaption() {
  return pickRandom(groupChatCaptions);
}
