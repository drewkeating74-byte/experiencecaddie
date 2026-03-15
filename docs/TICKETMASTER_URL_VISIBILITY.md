# Ticketmaster URL Visibility & Fallback Options

Expose exact URL values and how to inspect them. No link logic changes.

---

## 1. Frontend logging when you click Tickets

**Added in ItineraryResults:** When you click a Tickets button, the browser console now logs:

- **event_name** – concert/event name
- **venue** – venue string
- **venue_city** – city from `venue_obj` if present
- **date_time** – event date/time string
- **url_opened** – exact `e.url` passed to `window.open`
- **itinerary_id** – itinerary id (from URL param)
- **package_tier** – e.g. BRONZE, SILVER, GOLD

**How to use:** Open the itinerary page, open DevTools → Console, click Tickets for the Thackerville event. Find the log line `[TM_LINK_DEBUG] Tickets click` and copy the object (especially `url_opened`).

---

## 2. Easiest way to inspect saved `result_json` for that itinerary

### Option A: Browser console with `?tm_debug=1` (no DB access)

1. Open the itinerary in the app and add **`?tm_debug=1`** to the URL, e.g.  
   `https://yoursite.com/itinerary/abc123?tm_debug=1`  
   or  
   `https://yoursite.com/itinerary/your-share-slug?tm_debug=1`
2. Open DevTools → **Console**.
3. On load you’ll see:
   - **`[TM_LINK_DEBUG] Saved result_json (from DB)`** – summary: `itinerary_id` and `packages_events` (each package’s tier and list of events with `name`, `venue`, `date_time`, `url`).
   - **`[TM_LINK_DEBUG] Full result_json`** – the full saved object.
4. In `packages_events` or `Full result_json.packages[].events[]`, find the Thackerville event and note its **`url`**. That is the exact value stored in the DB and used for the Tickets button.

### Option B: Supabase Dashboard

1. **Supabase Dashboard** → **Table Editor** → **itineraries**.
2. Find the row: filter by **id** (if you have the UUID) or **share_slug** (if you use the slug in the URL).
3. Open the **result_json** column (click to expand or view as JSON).
4. Navigate: `result_json.packages[]` → pick the package → `events[]` → find the Thackerville event → read **`url`**.

That `url` is what the frontend uses as `e.url` and what gets logged as `url_opened` when you click Tickets.

---

## 3. What the search result stores, and where you can see it

The **search** Edge Function returns an array of **EventResult** objects. Each one has:

| Field         | Stored? | Meaning |
|---------------|--------|--------|
| **id**        | Yes    | TM `event.id` or a fallback id. |
| **name**      | Yes    | Event name. |
| **date_time** | Yes    | From TM. |
| **venue**     | Yes    | `{ name, city, state, ... }`. |
| **book_url**  | Yes    | Ticket URL we use; from `buildEventTicketUrl(event)` (TM `event.url` only if path contains `/event/`). |
| **source_url**| Yes    | Same as `book_url` in current code. |
| **event.url** (raw TM) | **No** | Not stored on EventResult. Only used inside the function to compute `book_url`/`source_url`. |

So the **search response** does **not** persist the raw Ticketmaster `event.id` or `event.url` anywhere the app can read later. It only exposes **id**, **book_url**, **source_url**, and the other EventResult fields.

**Where you can see those search values:**

- **Edge Function logs (best):** Supabase → Edge Functions → **search** → Logs. Look for `[TM_LINK_DEBUG] search mapEvent` for each event: `tm_event_id`, `tm_event_url`, `book_url`, `name`. That’s the only place you see raw TM `event.id` and `event.url` and the resulting `book_url` for the same event.
- **If logs are unreliable:** The app does not persist the raw search response. Options:
  1. **Temporarily** log the search response in the client: in **ExperienceBuilder** (or wherever you call the search function), after you get `searchResult`, add something like `console.log("[TM_LINK_DEBUG] search response events", searchResult.events)` and then trigger a new itinerary generation so that log runs. Then you’ll see the **EventResult** objects (with `id`, `book_url`, `source_url`) that were sent to generate-itinerary.
  2. Compare **saved event URL** (from result_json via Option A or B above) with the **clicked URL** (from the new Tickets-click log). If they’re the same, the frontend is not changing it; the value came from the DB. If the DB `url` is already the one that 404s, the problem is upstream (search or TM `event.url`).

---

## 4. Should the clicked URL equal search `book_url` or final saved `e.url` (or both)?

**From the current code:**

- The **clicked** URL is **exactly** `e.url` from **saved** `result_json` for that package and event. The button does `trackClick(..., e.url)` and then `window.open(url)`; there is no other transformation.
- **Saved** `e.url` is set in **generate-itinerary**:
  - From the **LLM** output (which is instructed to use the URLs from “REAL DATA”).
  - Then **enrichment** overwrites `e.url` with `src.book_url || src.source_url` when an event is matched by name to a search event. So when a match happens, saved `e.url` is the search **book_url** (or source_url, same value).
- So:
  - **Clicked URL** = **final saved event `e.url`** (always).
  - When enrichment **matched** that event by name, **final saved `e.url`** = **search `book_url`** for that event.
  - So in the normal case (match found), **clicked URL** = **saved `e.url`** = **search `book_url`**. All three should be identical. If the link 404s, then that same URL was (a) returned by search as `book_url`, (b) written into result_json by generate-itinerary, and (c) opened by the frontend. So the failure is either **TM `event.url` was already bad** (we use it as-is when it contains `/event/`), or **enrichment didn’t match** and the LLM echoed a different URL.

---

## 5. If Ticketmaster `event.url` is bad: fallback options (ranked by safety)

Do **not** implement until we’ve confirmed from logs/visibility that the 404 URL is the same as TM’s `event.url` (and that we’re not changing it).

**Ranked by safety (safest first):**

1. **Hide the Tickets button**  
   - If we don’t have a URL we trust (e.g. we rejected TM `event.url` or we know it 404s), do not set `book_url`/`source_url` and do not show a ticket link.  
   - **Safety:** Highest – user is never sent to a wrong or broken page.  
   - **Downside:** No ticket link for that event.

2. **Generic Ticketmaster homepage**  
   - Use `https://www.ticketmaster.com/` when we have no event-specific URL.  
   - **Safety:** High – page always exists; user can search themselves.  
   - **Downside:** Not event-specific; weaker UX.

3. **Ticketmaster search URL (artist + city + date)**  
   - Build a search URL, e.g.  
     `https://www.ticketmaster.com/search?q=<artist>+<city>+<date>` (or whatever TM’s public search format is; would need to be verified).  
   - **Safety:** Medium – depends on TM’s search being stable and not 404ing; might land on a list or artist page.  
   - **Downside:** Not a direct event link; format may change; could still be confusing.

4. **Keep using TM `event.url` but relax checks**  
   - e.g. use `event.url` even when path doesn’t contain `/event/`.  
   - **Safety:** Lower – we already know some TM URLs 404 or go to artist pages; relaxing checks can make that worse.  
   - **Not recommended** until we know the current 404 is not due to our `/event/` filter.

**Recommendation:** First confirm the exact URLs (Tickets-click log + saved result_json with `?tm_debug=1`). If the opened URL is the same as the one in result_json and that URL 404s, then the bad value came from search (TM `event.url` or our use of it). In that case, prefer **1 (hide button)** or **2 (generic TM)** as the safest fallbacks; only consider **3** if you verify TM’s search URL format and behavior.

---

## 6. Remove temporary visibility later

When done diagnosing:

1. **ItineraryResults**
   - Remove the `[TM_LINK_DEBUG] Tickets click` `console.log` (and the wrapper) from the Tickets button onClick.
   - Remove the `?tm_debug=1` useEffect that logs saved result_json.
2. Redeploy or refresh the frontend as needed.

Edge Function debug logs (`[TM_LINK_DEBUG]` in search and generate-itinerary) can be removed separately when you’re done with backend diagnosis.
