# Ticketmaster Button URL Mismatch – Root Cause

## Step 1: Relevant files and root cause

### Files involved

- **`apps/web/src/pages/ItineraryResults.tsx`** – Renders itinerary from `itinerary.result_json`; one **Tabs** (BRONZE / SILVER / GOLD), then **packages.map** → each **TabsContent** renders that package’s **Events** section from **pkg.events** (filtered to non-extras), and each event card has a Tickets button that calls **trackClick(pkg.tier, "ticket", e.name, e.url)** and **window.open(e.url)**.

### How the button is bound

- **Data:** `result = itinerary.result_json`, `packages = result.packages || []`.
- **Per tab:** For each `pkg` we have **eventItems = (pkg.events || []).filter(e => !extrasTypes.includes(e.type))**.
- **Per event:** We **eventItems.map((e, i) => ...)** and render one card per `e` (name, venue, date_time) and one **Button** that uses **e.url** in **onClick** via closure: **onClick={() => trackClick(..., e.name, e.url)}**.
- So the button is bound to **that** `e` in the map; the URL opened is **e.url** for that same `e`.

### Are there multiple event arrays?

- **Yes.** There are three separate lists: one per package (BRONZE, SILVER, GOLD). Each package has **pkg.events**; we filter to **eventItems** and map over that. So we have three “Events” blocks (one per tab), each with its own **eventItems** and its own **e** in the map.

### What the button reads

- The button uses **e.url** only (no derived URL, no other field). So in code it **does** read the same **e** that is used for the card (e.name, e.venue, e.date_time).

### Why you can see a “mismatch”

- You saw **saved event url in result_json: winstar (scissortail)** and **clicked url_opened: ticketmaster (santana)**. So either:
  1. **Different packages:** The event you inspected in **result_json** was from one package (e.g. BRONZE: “Scissortail” with winstar URL). The Tickets button you clicked was on **another** tab (e.g. SILVER or GOLD), where the same or another event (e.g. “Santana” at Thackerville) has the TM URL. So you compared **one package’s** stored event to **another package’s** button.
  2. **Same package, different events:** In one package, **pkg.events** can have multiple entries (e.g. Santana with TM url, Scissortail with winstar). You may have looked at one event in the debug output (e.g. the one with winstar) while the button you clicked was for the other (Santana with TM).

So the UI is not “mixing” URLs for a single event object; it’s opening **the** **e.url** for **the** event whose button you clicked. The mismatch comes from comparing **two different events** (different package or different index in the same package).

### Root cause

- **Event cards use index-only keys:** **key={i}** (e.g. `0`, `1`) is used for the event cards. Index is not unique across packages, and it doesn’t identify the event. That can make it harder to reason about “which event is which” and, in theory, can affect React’s reconciliation (e.g. when switching tabs or when list order differs).
- **No guarantee the opened URL is the one on the card:** We rely on the closure over **e**. If React ever reused a node or closure in an unexpected way, we could open the wrong URL. To make the behavior bulletproof, we should **read the URL from the same DOM element we rendered for that card** (e.g. a **data-event-url** on the button) at click time, so the link we open is exactly the one displayed for that button.

---

## Step 2: Smallest safe fix

1. **Stable, unique key per event card**  
   Use a key that includes **pkg.tier** and event identity (e.g. name + date_time) so each card is uniquely tied to one package and one event and React doesn’t reuse the wrong node.

2. **Open the URL from the clicked button**  
   Set **data-event-url={e.url}** on the Tickets button and, in the click handler, read **url = button.getAttribute("data-event-url")** and pass that into **trackClick** / **window.open**. That way the URL we open is always the one that was rendered for that specific button, not from a closure that might (in theory) refer to another **e**.

After this, the Tickets button will always open the exact saved URL for the event shown on that card.
