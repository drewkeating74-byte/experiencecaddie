# Experience Caddie – Project Plan vs Current State

**Document added:** 2026-03-02

This doc tracks alignment between the product plan (from the Deep Research Report on an Autonomous Concert + Golf Tourism Packaging Agent) and the current implementation.

---

## Alignment

| Plan element | Current status |
|--------------|----------------|
| **Product concept** | ✅ Golf + concert weekend packages for males 30–60 |
| **API-first approach** | ✅ `/api/search` as central data layer |
| **Flow: search → compose** | ✅ ExperienceBuilder calls `/api/search`, then passes results to `generate-itinerary` for LLM composition |
| **No scraping** | ✅ No crawling; prepared for API integrations |
| **Affiliate / tracking** | ✅ `track-click` edge function and `click_events` |
| **Admin-configurable filters** | ✅ `app_settings` with search filters (capacity, distance, tee windows, etc.) |
| **Redirect-to-provider** | ✅ "Book" / "Tickets" / "Tee Times" links open provider sites |
| **Hotel inclusion** | ⚠️ Not emphasized in plan, but present (Expedia, Booking, Hotels.com) |

---

## Gaps

### 1. Real data sources (largest gap)
- **Plan:** Ticketmaster Discovery API/Feed, GolfNow APIs, Google Places, Routes API.
- **Current:** Mock data only. `/api/search` returns hardcoded events, courses, and hotels; no real API integrations.

### 2. Data schema / pipeline
- **Plan:** Tables for `artists`, `events`, `venues`, `ticket_snapshots`, `golf_courses`, `tee_time_snapshots`, `distance_matrix`, `packages`, `audit_log`; feed ingestion.
- **Current:** `itineraries`, `app_settings`, `click_events`, and seed tables with different structure. No feed ingestion, no snapshot tables, no distance matrix.

### 3. Concert provider mix
- **Plan:** Ticketmaster as primary; Bandsintown/Songkick only with licensing.
- **Current:** Ticketmaster, StubHub, SeatGeek as deep links only (no APIs). No Ticketmaster Discovery API/Feed.

### 4. Golf source
- **Plan:** GolfNow APIs (or fallback to "call to confirm").
- **Current:** GolfNow and TeeOff as deep links only; no GolfNow API.

### 5. Geo / routing
- **Plan:** Google Places for golf discovery, Routes API for venue→course drive times.
- **Current:** None.

### 6. Compliance & freshness
- **Plan:** Caching TTLs, attribution, "as-of" timestamps, refresh cadence, policy layer.
- **Current:** None.

### 7. Autonomous feed ingestion
- **Plan:** Scheduler/cron for feed ingestion (e.g., Ticketmaster Discovery Feed).
- **Current:** Fully on-demand; no background jobs.

### 8. Human-in-the-loop
- **Plan:** Approval gate for new "public access" claims, high-value packages, attribution review.
- **Current:** No approval workflow.

---

## Summary

- **Strong alignment:** Product vision, API-first design, search→compose flow, affiliate tracking, admin filters, redirect-to-provider.
- **Largest gap:** Real data sources and pipeline. Plan Phase 1 (6–10 weeks) is largely ahead of current state.
- **Next logical step:** Wire the first real connector (Ticketmaster Discovery API or Feed) into `/api/search`, then add GolfNow or Google Places.
