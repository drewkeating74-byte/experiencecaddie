# Ticketmaster Link – End-to-End Diagnosis

Use this doc to capture **actual** values from logs and determine the root cause. Do not change link logic until the logs prove what is wrong.

---

## 1. Files involved

| Stage | File | What it does |
|-------|------|---------------|
| **Ticketmaster API → search** | `apps/web/supabase/functions/search/index.ts` | Fetches events from TM, calls `buildEventTicketUrl(event)` (uses only `event.url` if path contains `/event/`), sets `book_url` and `source_url` on each EventResult. |
| **Search → generate-itinerary** | `apps/web/supabase/functions/generate-itinerary/index.ts` | Receives search results; passes events (with `book_url`/`source_url`) to LLM as REAL DATA; after LLM responds, enriches package events by name and sets `e.url = src.book_url \|\| src.source_url` when matched; saves `result_json`. |
| **DB → UI** | `apps/web/src/pages/ItineraryResults.tsx` | Loads itinerary by id/slug, reads `result_json.packages[].events[]`; "Tickets" button uses `e.url` and calls `trackClick(..., e.url)` → `window.open(url)`. |

Data flow: **TM API `event.id` / `event.url`** → **search `book_url`/`source_url`** → **generate-itinerary input → LLM → enrichment `e.url`** → **saved `result_json`** → **ItineraryResults `e.url`** → **window.open(url)**.

---

## 2. Exact values to capture (from new logs)

Temporary `[TM_LINK_DEBUG]` logs were added so you can see real values at each stage.

### Step A: Create a **new** itinerary

- In the app: run a **new** search and **Generate My Itinerary** (do not open an old itinerary).
- Note the itinerary id or share slug and the **created_at** time (or “just created”).
- This ensures you are testing the **current** search + generate-itinerary code and not stale `result_json`.

### Step B: Supabase – search function logs

1. Supabase Dashboard → **Edge Functions** → **search** → **Logs**.
2. Find the log line(s) for the request that ran when you generated the itinerary.
3. For each event you care about (the one whose link fails), copy:

| Field | Where | Example / meaning |
|-------|--------|-------------------|
| **Ticketmaster API event.id** | `[TM_LINK_DEBUG] search mapEvent` → `tm_event_id` | e.g. `vv16AZAjJPOZACd2ad` |
| **Ticketmaster API event.url** | Same log → `tm_event_url` | Raw URL from TM (or undefined) |
| **search result book_url** | Same log → `book_url` | What we set as ticket link (or undefined) |
| **search result source_url** | Same as `book_url` in code | Same value as `book_url` |

Paste the **exact** values here (for one failing event):

- `tm_event_id`: 
- `tm_event_url`: 
- `book_url`: 

### Step C: Supabase – generate-itinerary function logs

1. **Edge Functions** → **generate-itinerary** → **Logs**.
2. For the same run (same time as Step B), find:

| Log line | What to copy |
|----------|----------------|
| `[TM_LINK_DEBUG] generate-itinerary input events` | Full array: for each event, `name`, `book_url`, `source_url`. |
| `[TM_LINK_DEBUG] generate-itinerary enrich event` | For the failing event: `name`, `url_before`, `url_after`, `matched`. |
| `[TM_LINK_DEBUG] generate-itinerary final saved event` | For the failing event: `pkg_tier`, `name`, `url`. |

Paste the **exact** values for the failing concert:

- **Input event** (from “input events”): `name`, `book_url`, `source_url`:
- **After enrich**: `url_before`, `url_after`, `matched`:
- **Final saved**: `url`:

### Step D: Frontend – URL actually opened

1. Open the **same new** itinerary in the app (by id or share link).
2. Open browser **Developer Tools** → **Console**.
3. Click the **Tickets** button for the concert that 404s.
4. Find: `[TM_LINK_DEBUG] ItineraryResults Tickets click` and copy `label` and `url`.

Paste here:

- **Rendered/clicked url** (what the UI opened): 

---

## 3. New vs stale itinerary

- **New itinerary:** You ran “Generate My Itinerary” **after** the latest deploy of both **search** and **generate-itinerary**. The itinerary was just created in this test.
- **Stale itinerary:** Itinerary was generated **before** those deploys, or you are opening an old saved/share link. Its `result_json` was saved with whatever URLs existed at that time (e.g. old `event.id`-based URLs or old TM `event.url`).

If you are testing an **old** itinerary:

- The **search** and **generate-itinerary** logs from **this** test will be for a **different** (new) run; they will not match the event/url on the old page.
- The **exact value** that matters for the 404 is the **url** in `result_json` for that old itinerary (i.e. what ItineraryResults renders and what you see in `[TM_LINK_DEBUG] ItineraryResults Tickets click`). That URL was fixed at generation time and will not change until you generate a new itinerary.

**Conclusion:** For this diagnosis, use a **newly generated** itinerary and the logs from that **same** run. Then compare: TM `event.url` → search `book_url` → generate-itinerary input → enriched/final `e.url` → frontend clicked `url`.

---

## 4. Root cause (choose one based on your captured values)

Use the exact values you pasted above.

| Observation | Root cause |
|-------------|------------|
| **Stale data** | You tested an old itinerary. `result_json` still has a pre-fix URL (e.g. `https://www.ticketmaster.com/event/{api_id}` or an old TM link). **Fix:** Generate a new itinerary and test the new link; no code change. |
| **event.url is bad** | In **search** logs, `tm_event_url` is present and we set it as `book_url`, but that same URL 404s when opened. So Ticketmaster’s `event.url` for this event is wrong or expired. **Fix:** Treat TM `event.url` as untrusted for this case; consider not showing a ticket link when we only have that URL, or try event-detail API if available. |
| **event.url missing or rejected** | In **search** logs, `tm_event_url` is missing or does not contain `/event/`, so `book_url` is undefined. So we never had an event-level URL. **Fix:** Either accept no ticket link for such events, or (if TM provides another field) use it; do not build a URL from `event.id`. |
| **Wrong event selected** | Search had the correct `book_url` for event A, but the itinerary shows a different event B (e.g. different artist/date) and B’s URL is wrong or missing. So the bug is matching/selection (name mismatch, LLM picked different event). **Fix:** Improve event matching or prompt so the concert in the package is the one from search. |
| **LLM preserved wrong URL** | In **generate-itinerary** logs: “input events” has correct `book_url`; “enrich event” shows `matched: false` for this concert, and “final saved event” has a different/wrong `url`. So the LLM echoed a different URL and we didn’t overwrite it because name match failed. **Fix:** Improve name normalization/matching so we match and set `e.url` from search; or pass a stable id and match on that. |
| **Enrichment not deployed** | “input events” has correct `book_url`; “enrich event” shows `matched: true` but `url_after` is still wrong or empty; or “final saved event” still has wrong `url`. Then enrichment logic may not be applied (e.g. old deploy). **Fix:** Redeploy **generate-itinerary** and test again with a new itinerary. |
| **Frontend wrong url** | “Final saved event” in logs has the correct URL, but `[TM_LINK_DEBUG] ItineraryResults Tickets click` shows a different URL. Then the UI is reading from the wrong place or the wrong package/event. **Fix:** Inspect how ItineraryResults gets `e.url` (from `result_json.packages[].events[]`) and fix the binding. |

---

## 5. Recommended fix (only after you have the observed values)

- **Do not** change link logic (e.g. build URL from `event.id`) until the logs show that the failure is due to something other than stale data or wrong event/LLM/enrichment.
- Fill in **Section 2** with the exact values from your **new** itinerary and logs.
- Choose the **one** root cause from Section 4 that matches your observations.
- Then apply the corresponding fix from the table (new itinerary, enrichment deploy, matching, or UI), or ask for a concrete code change based on the chosen row.

---

## 6. Removing the debug logs

After the fix is confirmed:

1. **search:** Remove the `console.log("[TM_LINK_DEBUG] search mapEvent", ...)` block in `mapEventToResult`.
2. **generate-itinerary:** Remove the three `console.log("[TM_LINK_DEBUG] generate-itinerary ...", ...)` calls (input events, enrich event, final saved event).
3. **ItineraryResults:** Remove the `if (vendor === "ticket") { console.log(...) }` block in `trackClick`.
4. Redeploy **search** and **generate-itinerary**; redeploy or refresh the frontend as needed.
