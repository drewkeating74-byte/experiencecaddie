# Ticketmaster Concert Link Diagnosis (Plain English)

Diagnosis of why the “Tickets” link leads to Page Not Found. No code changes yet—analysis only.

---

## 1. Files involved

| File | Role |
|------|------|
| **`apps/web/supabase/functions/search/index.ts`** | Fetches Ticketmaster events, maps each to `EventResult` with `book_url` / `source_url`. **Only place that sets the concert URL** for search-sourced events. |
| **`apps/web/supabase/functions/generate-itinerary/index.ts`** | Receives search results (including events with `book_url`/`source_url`), passes them to the LLM as “REAL DATA” with `url: e.book_url \|\| e.source_url`, and stores the LLM’s JSON. **Does not overwrite event URLs** when enriching; it only adds provider, venue_obj, date_time. |
| **`apps/web/src/pages/ItineraryResults.tsx`** | Reads `result_json.packages[].events[]`; each event has `e.url`. The “Tickets” button calls `trackClick(..., e.url)` and then `window.open(url, "_blank")`. So the link the user hits is **exactly** the `url` that came from the LLM, which was copied from the search data. |
| **`apps/web/src/pages/SearchPreview.tsx`** | Uses `event.book_url` for the ticket link when showing search preview (same source: search API). |
| **`apps/web/src/lib/api/search.ts`** | Client that calls the search Edge Function; types and fallback mock data only. |

**Summary:** The concert ticket URL is **created only in the search function** (Ticketmaster path). Everything else either passes it through (generate-itinerary → LLM → result_json) or displays it (ItineraryResults, SearchPreview). No other code builds or overwrites that URL.

---

## 2. Current event link data flow

1. **Search (Edge Function)**  
   - Calls Ticketmaster Discovery API: `GET https://app.ticketmaster.com/discovery/v2/events.json` (with keyword, city, state, date range).  
   - For each event in the response, **`buildEventTicketUrl(event)`** is used to set the ticket URL.  
   - Current logic: **if `event.id` exists** → return `https://www.ticketmaster.com/event/${event.id}`; **else** → return `event.url`.  
   - That value is assigned to both **`source_url`** and **`book_url`** on `EventResult`.  
   - So today we **prefer a URL we build from `event.id`** and only use the API’s `event.url` when `event.id` is missing.

2. **Generate-itinerary**  
   - Receives `search_results.events` (each with `book_url`, `source_url`).  
   - Injects into the prompt: `url: e.book_url || e.source_url` for each concert in “REAL DATA”.  
   - LLM returns packages with `events[].url`.  
   - Enrichment step matches events by name and adds `provider`, `venue_obj`, `date_time` from search; **it does not set or fix `e.url`**.  
   - So the URL the user sees is whatever the LLM echoed from the REAL DATA, which is the URL we put in search (the constructed one when `event.id` exists).

3. **ItineraryResults (and share flow)**  
   - Reads `pkg.events[].url` and uses it for the “Tickets” button and `trackClick(..., e.url)` → `window.open(e.url)`.  
   - So the **same URL** that search produced is what gets opened; there is no second source of truth.

End-to-end: **Search builds the URL (currently from `event.id`) → that URL is the only one in the chain → user clicks it → Page Not Found.**

---

## 3. Upstream fields available (Ticketmaster Discovery API)

From the code and Ticketmaster docs:

- **`event.id`** – Present. This is the **Discovery API’s internal event identifier** (e.g. alphanumeric like `vv16AZAjJPOZACd2ad`). It is **not** the same as the ID used in public Ticketmaster event URLs.
- **`event.url`** – Typed in our code as `url?: string`. The Discovery API typically returns a **public event page URL** for this event (e.g. `https://www.ticketmaster.com/event/...` or a slugged URL). That URL is intended for end users and uses the correct “URL” ID.
- **`event.name`**, **`event.dates`**, **`event._embedded.venues`**, **`event._embedded.attractions`** – Used for display and matching; not used to build the ticket link. No other URL fields (e.g. `links`, attraction/venue URLs) are read in our code for the ticket link.

Important: Public Ticketmaster links use a **different ID format** than the Discovery API’s `event.id`. Using `event.id` in `https://www.ticketmaster.com/event/${event.id}` is **not guaranteed to work** and is known to produce 404s when the API ID and the public URL ID differ.

---

## 4. Why the current link fails

- We **always** build the URL as `https://www.ticketmaster.com/event/${event.id}` when `event.id` is present.  
- That uses the **API’s event ID**, not the ID used on ticketmaster.com.  
- Ticketmaster’s public event URLs can use a different ID (and sometimes a slug). So the constructed URL points to a resource that doesn’t exist at that path → **Page Not Found**.  
- We only use `event.url` when `event.id` is missing, so we are **preferring the wrong source** whenever the API gives us both.

So the failure is not from the wrong file or the wrong field name; it’s from **using the wrong identifier** (API `event.id`) to construct the public URL instead of using the URL the API already provides (`event.url`).

---

## 5. Is upstream `event.url` the safest direct link? What fallback?

- **Yes.** The safest direct link we have is **`event.url`** from the Ticketmaster response. It is the official event-level URL intended for users and uses the correct public ID/slug.  
- **Fallback:** If `event.url` is missing or invalid (e.g. empty string), the “smallest safe” fallback is to **not** build a URL from `event.id`, because that is known to 404. Options:  
  - Use a generic Ticketmaster search or homepage link (e.g. `https://www.ticketmaster.com/`), or  
  - Omit the link for that event so we don’t send users to a 404.  
- Using **only** `event.url` when present, and a generic or no link when absent, is safer than ever constructing `https://www.ticketmaster.com/event/${event.id}` from Discovery API `event.id`.

---

## 6. Smallest safe fix (recommended)

- **Where:** `apps/web/supabase/functions/search/index.ts`, in **`buildEventTicketUrl`** (and thus in **`mapEventToResult`**).  
- **What:**  
  - **Prefer the API’s event URL:** If `event.url` exists and looks like a valid HTTP(S) URL, use it for `source_url` and `book_url`.  
  - **Do not** construct `https://www.ticketmaster.com/event/${event.id}` from the Discovery API `event.id`.  
  - **Fallback:** If `event.url` is missing or invalid, set the ticket link to a generic Ticketmaster URL (e.g. `https://www.ticketmaster.com/`) or leave it unset so the UI can hide the button.  
- **Why this is enough:** The concert URL is only set in search; generate-itinerary and the UI just pass it through. Fixing the URL in search fixes the link everywhere (SearchPreview, ItineraryResults, share, etc.) without touching other files.  
- **Optional hardening:** In generate-itinerary, when enriching events from search by name, you could **overwrite** `e.url` with `src.book_url || src.source_url` when a match is found, so even if the LLM changes the URL, we still show the URL from search. That’s a secondary improvement; the primary fix is in search.

---

## Summary table

| Question | Answer |
|----------|--------|
| Where is the concert URL created? | Only in **search** (`buildEventTicketUrl` → `mapEventToResult`). |
| Where is it stored / passed? | Search → `book_url`/`source_url` → generate-itinerary prompt (“REAL DATA”) → LLM → `result_json.packages[].events[].url` → ItineraryResults `e.url`. |
| What does the API give us? | `event.id` (API internal ID), `event.url` (public event page URL). Optional: name, dates, venues, attractions. |
| Are we using a true event-level URL? | We *intend* to, but we build it from `event.id`, which is the wrong ID for public URLs. |
| Why 404? | Public Ticketmaster URLs use a different ID than Discovery API `event.id`; our constructed URL is invalid. |
| Safest fix? | Use **`event.url`** when present; do not build from `event.id`; fall back to generic or no link when `event.url` is missing. |
| Smallest change? | In search: prefer `event.url`; remove or demote the `event.id`-based construction; add a safe fallback. |
