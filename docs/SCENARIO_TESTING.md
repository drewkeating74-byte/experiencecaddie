# Experience Caddie – Structured Scenario Testing

This document describes the main search and itinerary flows, suggested test scenarios, and what to watch for. Use it together with the **Testing Checklist** and **Bug Log Template** for manual testing.

---

## 1. Current flow (plain English)

**Entry:** User goes to Home → “Start Your Experience” (or similar) → lands on **Experience Builder** (`/experience`).

**Three starting options:**

1. **“I already know who I want to see”** – User enters an artist name. They then set city (or “flexible”), dates (or “flexible”), budget, group size, and click **Generate My Itinerary**. The app calls the **search** Edge Function (artist + city + dates), then **generate-itinerary** with those search results. User is redirected to `/share/{slug}`.

2. **“Show me the best upcoming shows”** or **“I’m flexible — show me something great”** – **Discover flow.** User sets city/dates (and optionally genres for “best upcoming shows”). On Generate, the app first calls **generate-itinerary** with `discover_concerts: true` (no full search yet). Backend returns a short list of **concert options**. User **picks one** → app then runs **search** for that artist + city + dates, then **generate-itinerary** again with search results and the chosen concert. Redirect to `/share/{slug}`.

**After generation:** `/share/{slug}` immediately **redirects** to `/itinerary/{slug}`. So the itinerary is always shown at `/itinerary/{id}` where `id` can be the **share slug** (e.g. `k7Jm2p`) or the real **UUID**. The page loads the itinerary by slug first, then by UUID if needed.

**On the itinerary page:** User sees Bronze / Silver / Gold tabs, each with descriptor text, lodging, concerts, golf, extras. They can:
- Click **Find Tickets** / **Tickets** → track-click is called (if logged in), then the ticket URL opens in a new tab.
- Click hotel or golf links → same pattern (track-click + new tab).
- **Save** a tier to “My Trips” (requires login).
- **Share** (copy link or send email).
- **Refresh** – currently shows a toast and a “Refresh complete” after 2 seconds; there is **no backend refresh** yet (TODO in code).

**Login:** From any page, if the user needs to log in (e.g. to save or to get track-click to work), they can go to `/auth`. The Auth page supports a `?redirect=/path` query. After login (email or Google), the app sends them back to that path.

---

## 2. Test scenarios

### Scenario A: Artist + major city

**What to do:** Choose “I already know who I want to see”, enter a well-known artist (e.g. Taylor Swift, Luke Combs) and a major city (e.g. Nashville, Austin). Set dates that include known tour dates. Pick budget and group size. Click **Generate My Itinerary**.

**What should happen:** Search returns events; generate-itinerary builds three packages; you are redirected to the itinerary page with Bronze/Silver/Gold filled with concerts, golf, and lodging. Tier descriptors appear. Links open to Ticketmaster (or correct vendor).

**What could go wrong:** Timeout (60s/120s), no events in date range, API errors, or weak/empty golf or hotel results so a tier looks thin.

**Watch for:** Loading time, clear error messages if something fails, that “Find Tickets” opens a valid Ticketmaster search (not 404), and that all three tiers feel distinct and useful.

---

### Scenario B: Artist + smaller city

**What to do:** Same as A but use a smaller city (e.g. Thackerville OK, Rogers AR) and an artist who plays there.

**What should happen:** Same as A, but with possibly fewer events or venues. Itinerary still builds; golf/hotels may be fewer or different.

**What could go wrong:** No events for that city in Ticketmaster, so search returns few or no events; generate-itinerary might still build something from fallbacks or look odd. Empty or repetitive sections.

**Watch for:** Whether the UI handles “few results” gracefully (no blank sections or confusing copy). Ticket links should still be TM search URLs, not 404s.

---

### Scenario C: Discover flow (best upcoming shows)

**What to do:** Choose “Show me the best upcoming shows”. Optionally pick genres. Set city and dates. Click **Generate My Itinerary**.

**What should happen:** First you see “Finding the best concerts…” then a **Pick your concert** screen with a short list of options (artist, venue, city, date). You choose one and click **Build my trip**. Then “Crafting Your Legendary Weekend…” and finally redirect to the itinerary.

**What could go wrong:** Discovery returns no concerts → “No concerts found” / no_results screen. Or discovery is slow/times out. Or the list is empty due to date/region.

**Watch for:** Clear transition from discovering → pick → building. Correct artist/venue/date on the built itinerary. “Get tickets” on the pick screen and “Find Tickets” on the itinerary both go to valid pages.

---

### Scenario D: Discover flow (I’m flexible)

**What to do:** Choose “I’m flexible — show me something great”. Set city and dates (or leave flexible). Generate.

**What should happen:** Same discover → pick → build flow as C, but concert suggestions are not tied to a specific artist you typed.

**What could go wrong:** Same as C. Few or no options in smaller cities or narrow date ranges.

**Watch for:** Suggestions feel relevant to city/dates. After you pick, the full itinerary matches the chosen concert and location.

---

### Scenario E: Login redirect flow

**What to do:** Open an itinerary via share link (e.g. `/itinerary/abc123`) **while logged out**. Click something that requires login: **Save** (bookmark) or **Find Tickets** / hotel / golf link (track-click requires login and redirects to auth). You should be sent to `/auth?redirect=/itinerary/abc123`. Log in (email or Google). After success, you should land back on `/itinerary/abc123`.

**What should happen:** After login, you return to the same itinerary page. You can then save and click links; track-click should succeed (no 400).

**What could go wrong:** Redirect URL missing or wrong so user lands on home or wrong page. Google OAuth not sending them back. Session not applied so “Log in to share, save, or book” still shows.

**Watch for:** URL in the address bar after login is exactly the itinerary you were on. One “Signed in with Google” (or similar) toast. No double redirects or blank screen.

---

### Scenario F: Share link flow (open in new incognito/device)

**What to do:** From a generated itinerary, copy the **Share** link (or use “Share via email” and open the link from the email). Open that link in a **new incognito window** or another device (logged out).

**What should happen:** Link is like `https://yoursite.com/share/k7Jm2p`. The app immediately redirects to `/itinerary/k7Jm2p`. The itinerary loads by slug; you see the same Bronze/Silver/Gold content. You can view everything. If you click Tickets/hotel/golf without logging in, you’re sent to auth with redirect back to that itinerary URL.

**What could go wrong:** Share link uses wrong base URL (e.g. localhost). Slug not found (404 or “Itinerary not found”). Page loads but result_json is empty or broken so tiers are empty or error.

**Watch for:** Share URL uses production domain. Incognito user sees full itinerary. After login from that page, track-click works (UUID is sent, not slug).

---

### Scenario G: Ticket / golf / hotel click behavior

**What to do:** On an itinerary page, **logged in**, click **Find Tickets** (or **Tickets**) on a concert, then a **hotel** link, then a **golf** link. Optionally open DevTools → Network and watch the `track-click` request.

**What should happen:** Each click sends one request to `track-click` with `itinerary_id` = UUID, `package_tier`, `vendor` (e.g. ticket, hotel, golf), `label`, `target_url`. Response 200. A new tab opens with the correct URL (Ticketmaster search, hotel site, or golf booking).

**What could go wrong:** 400 from track-click (e.g. invalid itinerary_id if slug was sent – should be fixed). Link opens wrong site (e.g. SeatGeek instead of Ticketmaster) or 404. Button opens nothing or wrong event.

**Watch for:** All three vendors (ticket, hotel, golf) call track-click and open the right URL. No 400. “Find Tickets” for TM events, “Tickets” for others. Label/URL in the request match the card you clicked.

---

### Scenario H: Regenerate / repeat search behavior

**What to do:** From Experience Builder, run the **same** request twice (same artist, city, dates). Then open an existing itinerary and click **Refresh** (if available on the itinerary page).

**What should happen:** Two separate generations create two itineraries (two share slugs). Each opens correctly. **Refresh** on the itinerary page currently only shows “Refreshing prices and availability…” and “Refresh complete” after ~2 seconds; **no backend re-fetch or re-generation** (implementation is TODO).

**What could go wrong:** Second generate overwrites the first (e.g. same slug), or one of the two fails. Refresh suggests data is updated but it isn’t.

**Watch for:** Each generate gives a new share link. Refresh button does not imply real price/availability refresh until that feature is built. No errors or duplicate-slug confusion.

---

### Scenario I: Thin or weak result sets

**What to do:** Use an artist with no (or almost no) tour dates in the chosen dates, or a very small city with no Ticketmaster events. Or use dates far in the past.

**What should happen:** For “I already know who I want to see” with no events: search may return few/zero events; generate-itinerary may still produce packages (e.g. from fallbacks or LLM). For discover flow: you may get “No concerts found” and options to try different dates or explore other artists.

**What could go wrong:** Blank or broken UI. Endless loading. Generic or unhelpful error. Packages with no concerts or duplicate/placeholder content.

**Watch for:** Clear “no results” or “no concerts” messaging in discover. On direct artist search, either a sensible itinerary or a clear message. No raw API errors or blank tabs.

---

### Scenario J: Save package and return

**What to do:** Log in. Open an itinerary. Click the **bookmark** (Save) on one tier (e.g. Silver). Go to “My Trips” (or wherever saved packages live). Open that saved package. Return to the same itinerary via share link. Check that the bookmark for that tier shows as saved (filled state).

**What should happen:** Saving stores the package for the user; the UI shows the bookmark as “saved”. My Trips shows the itinerary; opening it shows the same content and the same tier still marked saved.

**What could go wrong:** Save fails silently or shows an error. My Trips doesn’t list the package or link is wrong. Re-opening the itinerary doesn’t show the saved state.

**Watch for:** Visual feedback on save. Consistency between itinerary page and My Trips. No 400/500 when saving.

---

## 3. Quick reference – where things happen

| Flow / feature        | Where it happens (user path)                     | Backend |
|-----------------------|---------------------------------------------------|---------|
| Artist + city search  | Experience Builder → Generate                    | search, generate-itinerary |
| Discover → pick       | Experience Builder → Generate → Pick concert     | generate-itinerary (discover), then search + generate-itinerary |
| Share link            | Copy link or email → open `/share/slug`           | Redirect to `/itinerary/slug`; load by slug then UUID |
| Itinerary view        | `/itinerary/:id`                                  | REST: itineraries by slug or id |
| Track click           | Click Tickets / hotel / golf (logged in)          | track-click Edge Function |
| Login redirect        | Click Save or link while logged out → Auth        | Supabase Auth; redirect param |
| Refresh               | Itinerary page → Refresh button                  | **None** (TODO); UI only |

---

## 4. Files to keep in mind (for bug reporting)

- **ExperienceBuilder.tsx** – Entry choice, discover flow, generate, redirect to share.
- **SharedItinerary.tsx** – Redirect from `/share/:slug` to `/itinerary/:slug`.
- **ItineraryResults.tsx** – Load itinerary by slug/id, tabs, descriptors, trackClick, save, share, refresh.
- **Auth.tsx** – Redirect param, Google OAuth, success toast.
- **Supabase:** `search`, `generate-itinerary`, `track-click`, `send-share-email`.

Use the **Testing Checklist** for step-by-step execution and the **Bug Log Template** to record issues.
