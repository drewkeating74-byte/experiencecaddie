export const chatSets = [
  {
    id: "classic_group_chat",
    chatHeader: "The Group Chat",
    eyebrowLabel: "FOR THE CHAT THAT NEVER BOOKS ANYTHING",
    line1: "We actually doing a trip this year?",
    line2: "I'm in if there's golf.",
    line3: "Find a concert too.",
    line4: "Cool. Who's planning it?",
    brandReply: "Already built. ✓",
    replyTitle: "Golf + Concert Weekend",
    caption: [
      'Every group chat has the guy who says, "We should do a trip." Be the guy who actually sends the plan. 🏌️‍♂️🎸',
      "",
      "Pick the show. Experience Caddie builds the golf weekend around it.",
      "",
      "Send this to the chat. 👇",
      "",
      "#golftrip #guystrip #golfweekend #livemusic #weekendtrip #experiencecaddie",
    ].join("\n"),
  },

  {
    id: "annual_trip",
    chatHeader: "The Annual Trip Chat",
    eyebrowLabel: "THIS IS HOW THE TRIP HAPPENS",
    line1: "Are we skipping the trip again?",
    line2: "Absolutely not.",
    line3: "Golf Friday. Show Saturday?",
    line4: "Somebody pick the city.",
    brandReply: "Pick the show. We'll handle the rest.",
    replyTitle: "The Annual Trip, Built",
    caption: [
      "The annual trip doesn't schedule itself.",
      "",
      "Pick the show. Add the golf. Let Experience Caddie build the weekend.",
      "",
      "Send this to the group before another year gets away. 👇",
      "",
      "#annualtrip #golftrip #guystrip #livemusic #weekendgetaway #experiencecaddie",
    ].join("\n"),
  },

  {
    id: "birthday_trip",
    chatHeader: "Guys Trip 🏌️",
    eyebrowLabel: "THE GROUP CHAT, SOLVED",
    line1: "I'm not doing a dinner for my 40th.",
    line2: "Good. Trip instead.",
    line3: "Golf and a concert?",
    line4: "Now we're talking.",
    brandReply: "Weekend built. ✓",
    replyTitle: "Your Birthday Weekend",
    caption: [
      "A milestone birthday deserves more than dinner reservations.",
      "",
      "Pick a concert. Add a round. Build the weekend in minutes.",
      "",
      "Tag the guy with the next big birthday. 👇",
      "",
      "#birthdaytrip #guystrip #golfweekend #concertweekend #experiencecaddie",
    ].join("\n"),
  },

  {
    id: "old_friends",
    chatHeader: "Boys Weekend",
    eyebrowLabel: "ONE WEEKEND. NO PLANNING SPIRAL.",
    line1: "When was the last time we all hung out?",
    line2: "Don't ask questions you don't want answered.",
    line3: "Let's do golf and a show.",
    line4: "Send dates.",
    brandReply: "Here's the plan.",
    replyTitle: "One Weekend. Done.",
    caption: [
      "Life gets busy. The trip doesn't have to.",
      "",
      "Golf, live music, and one overdue weekend with the guys.",
      "",
      "Send this to the friends you don't see enough. 👇",
      "",
      "#oldfriends #guystrip #golftrip #livemusic #weekendtrip #experiencecaddie",
    ].join("\n"),
  },

  {
    id: "bachelor_trip",
    chatHeader: "Bachelor Party Trip",
    eyebrowLabel: "NOBODY HAD TO PLAN IT",
    line1: "Bachelor Party trip ideas?",
    line2: "Golf has to happen.",
    line3: "Concert that night?",
    line4: "That's the weekend.",
    brandReply: "Already built. ✓",
    replyTitle: "Bachelor Weekend, Built",
    caption: [
      "Bachelor weekend solved.",
      "",
      "Golf by day. Live music by night. One plan for the whole group.",
      "",
      "Send this to the best man. 👇",
      "",
      "#bachelortrip #golftrip #guystrip #concertweekend #experiencecaddie",
    ].join("\n"),
  },
];

export const REPLY_URL = "experiencecaddie.com";
export const CARD_IMAGE_URL =
  "https://experiencecaddie.com/hero-image.jpg";

export function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("pickRandom requires a non-empty array");
  }

  return arr[Math.floor(Math.random() * arr.length)];
}

let pendingGroupChatPost = null;

export function buildGroupChatPost() {
  const chatSet = pickRandom(chatSets);

  return {
    variantId: chatSet.id,
    variantKey: chatSet.id,
    label: chatSet.chatHeader,
    modifications: [
      { name: "chat_header", text: chatSet.chatHeader },
      { name: "eyebrow_label", text: chatSet.eyebrowLabel },
      { name: "chat_line_1", text: chatSet.line1 },
      { name: "chat_line_2", text: chatSet.line2 },
      { name: "chat_line_3", text: chatSet.line3 },
      { name: "chat_line_4", text: chatSet.line4 },
      { name: "reply_image", image_url: CARD_IMAGE_URL },
      { name: "reply_title", text: chatSet.replyTitle },
      { name: "reply_url", text: REPLY_URL },
      { name: "brand_reply", text: chatSet.brandReply },
    ],
    caption: chatSet.caption,
  };
}

function getPendingGroupChatPost(part) {
  if (!pendingGroupChatPost || pendingGroupChatPost[part]) {
    pendingGroupChatPost = {
      post: buildGroupChatPost(),
      modifications: false,
      caption: false,
    };
  }

  pendingGroupChatPost[part] = true;
  const post = pendingGroupChatPost.post;

  if (pendingGroupChatPost.modifications && pendingGroupChatPost.caption) {
    pendingGroupChatPost = null;
  }

  return post;
}

export function buildGroupChatModifications() {
  return getPendingGroupChatPost("modifications").modifications;
}

export function buildGroupChatCaption() {
  return getPendingGroupChatPost("caption").caption;
}
