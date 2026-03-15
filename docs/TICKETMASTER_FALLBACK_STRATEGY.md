# Ticketmaster Fallback Strategy (Implemented)

## Step 1: Fallback strategy and files

### Strategy

- **Problem:** Some Ticketmaster event-level URLs (from the API or built from id) return Page Not Found. We cannot know at runtime which links will 404.
- **Approach:** For events that come from our **Ticketmaster** search, we no longer use the direct event URL. We use a **Ticketmaster search URL** built from event name + city (+ state). That URL always lands on a valid search results page, so we never send users to a 404 from the Tickets button.
- **What we keep:** Non-Ticketmaster events (e.g. user-selected concert from discover flow, or future providers) still use their stored `book_url` / `e.url` as before.
- **Label:** For Ticketmaster-sourced events we show **"Find Tickets"** instead of **"Tickets"** so we don’t imply a guaranteed direct buy page; for other events we keep **"Tickets"**.

### Files updated

| File | Change |
|------|--------|
| **`apps/web/supabase/functions/search/index.ts`** | Replaced direct event URL with a Ticketmaster search URL for all TM events. Added `buildTicketmasterSearchUrl(name, city, state)`; `mapEventToResult` now sets `book_url` / `source_url` to that search URL. Removed `buildEventTicketUrl(event)` and the `/event/` path check. |
| **`apps/web/src/pages/ItineraryResults.tsx`** | For event cards, the ticket button label is **"Find Tickets"** when `e.provider === "ticketmaster"`, otherwise **"Tickets"**. |

### Button label

- **Ticketmaster events:** **"Find Tickets"** – makes it clear the user is going to a search page, not a guaranteed event buy page.
- **All other events:** **"Tickets"** – unchanged.

No other UI or backend logic was changed; generate-itinerary continues to use search `book_url` when enriching, so stored `e.url` is now the TM search URL for TM events.
