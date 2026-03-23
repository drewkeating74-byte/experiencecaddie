# Refresh + Reliability — Safest-Smallest Phase 1 Implementation Plan

**Context:** Trust UI, click tracking, scenario testing, and golf catalog Phase 1A are done. Next phase is Refresh + reliability before hotel API work.

**Goal:** Make Refresh a real, safe product capability. Do not overwrite the current itinerary until refresh succeeds. Keep share_slug and existing data stable on failure.

---

## 1. Revised Plain-English Recommendation

### What “real Refresh” should do

1. **Reconstruct search params** — Derive artist, city, state, dates from the stored itinerary and result_json (see section 3).
2. **Re-run search** — Call the search API with those params.
3. **Re-run generate-itinerary** — Pass `itinerary_id` + new `search_results` in refresh mode.
4. **Save only on success** — Backend overwrites `result_json` and `updated_at` only when the full LLM + parse pipeline succeeds. On any failure, return an error and do not write to the DB.
5. **Frontend: no local overwrite until success** — Only refetch and re-render when the backend returns 200. On error, show a toast; itinerary and share_slug stay unchanged.

### What the user should see

- A **Refresh** button near “Generated {date}”.
- While refreshing: “Refreshing prices and availability…” with a spinner; **Refresh button disabled**.
- On success: Toast “Refresh complete”; page updates; “Generated” timestamp updates.
- On failure: Toast with error message; itinerary stays as-is; Refresh button re-enabled.

### Safety guarantees

- **No overwrite until success** — Backend updates the DB only after a successful LLM run and parse.
- **Share slug stable** — Never change `share_slug` on refresh; same link always works.
- **Failure = no change** — If search fails, generate fails, or LLM/parse fails, the itinerary row is not modified.

---

## 2. Exact Frontend / Backend Flow

### Frontend (ItineraryResults.tsx)

```
1. User clicks Refresh
2. Set refreshing = true → disable Refresh button, show "Refreshing..." toast or inline text
3. Derive search params from itinerary (see section 3)
4. Call fetchSearch(params) → if error: toast.error, set refreshing = false, stop
5. Call generate-itinerary with { itinerary_id, payload: { search_results } } → if error: toast.error, set refreshing = false, stop
6. Refetch itinerary from DB (same slug/id)
7. setItinerary(fetched), toast.success("Refresh complete"), set refreshing = false
```

### Backend (generate-itinerary)

```
1. If body.itinerary_id AND (body.payload?.search_results OR body.search_results) → REFRESH MODE
2. Fetch itinerary by id; if not found → 404
3. Use request's search_results (not stored data)
4. Keep existing share_slug (do NOT generate a new one)
5. Set status = "generating" (optional, for polling; or skip if frontend handles loading)
6. Run LLM, parse JSON
7. If parse fails or LLM errors → return 500, do NOT update DB
8. Only on success: UPDATE itineraries SET result_json = ?, status = 'generated', updated_at = now() WHERE id = ?
9. Return { success: true, share_slug: itinerary.share_slug }
```

### Failure behavior

| Failure point | Frontend | Backend |
|---------------|----------|---------|
| Search API error | Toast error, re-enable Refresh | N/A |
| generate-itinerary 4xx/5xx | Toast error, re-enable Refresh | Do not UPDATE |
| LLM timeout / parse error | Toast error, re-enable Refresh | Do not UPDATE |
| Network error | Toast "Could not reach server", re-enable Refresh | N/A |

---

## 3. Reconstructing Search Inputs by Entry Flow

We infer the original search params from `itinerary` and `result_json` because we do not store `search_context` in Phase 1.

### Flow 1: Known artist + city

**How to detect:** `event_details` is a short string (typical artist name) and `preferences.flexible_location` is false or absent.

**Search params:**
- `artist` = `itinerary.event_details` (trimmed), if it looks like an artist (e.g. length &lt; 80, no "genres:" prefix).
- `city` = `itinerary.city` (skip if "flexible" or empty).
- `state` = from `result_json.packages[0].events[0].venue.state`, or undefined.
- `dates` = `itinerary.start_date`, `itinerary.end_date`.
- `destination` = `{ city, state }`.

**Fallback:** If `event_details` looks like a long prompt (e.g. "genres: Country"), treat as no artist; search by city only.

### Flow 2: Discover / pick a concert

**How to detect:** First event is the same across packages (user picked one concert). `event_details` may be empty or contain genre hints.

**Search params:**
- `artist` = `result_json.packages[0].events[0].name` (often the artist for TM events).
- `city` = `result_json.packages[0].events[0].venue?.city` or `itinerary.city`.
- `state` = `result_json.packages[0].events[0].venue?.state` or undefined.
- `dates` = `itinerary.start_date`, `itinerary.end_date`.

### Flow 3: Flexible (I'm flexible — show me something great)

**How to detect:** `itinerary.city === "flexible"` or `preferences.flexible_location === true`.

**Search params:**
- `artist` = undefined.
- `city` = `result_json.packages[0].events[0].venue?.city` if present and not empty, else `"Austin"`.
- `state` = from first event's venue, or undefined.
- `dates` = `itinerary.start_date`, `itinerary.end_date`.

**Rationale:** Flexible originally used a fallback city (e.g. Austin) for search. We reuse the concert's city if we have it, otherwise default to Austin.

### Shared logic (pseudocode)

```ts
function deriveSearchParams(itinerary: Itinerary, result_json: any): SearchRequest {
  const start = itinerary.start_date;
  const end = itinerary.end_date;
  const prefs = itinerary.preferences || {};
  const pkgs = result_json?.packages || [];
  const firstEvent = pkgs[0]?.events?.[0];
  const venueCity = firstEvent?.venue?.city;
  const venueState = firstEvent?.venue?.state;

  let artist: string | undefined;
  let city: string;

  if (itinerary.city === "flexible" || prefs.flexible_location) {
    // Flow 3: Flexible
    artist = undefined;
    city = venueCity || "Austin";
  } else if (firstEvent && pkgs.every((p: any) => p.events?.[0]?.name === firstEvent.name)) {
    // Flow 2: Discover (same event in all packages)
    artist = firstEvent.name;
    city = venueCity || itinerary.city;
  } else {
    // Flow 1: Artist + city
    const ed = (itinerary.event_details || "").trim();
    artist = ed && ed.length < 80 && !ed.toLowerCase().startsWith("genres:") ? ed : undefined;
    city = itinerary.city;
  }

  return {
    artist,
    destination: { city: city || "Austin", state: venueState },
    dates: { start_date: start, end_date: end },
    group_size: itinerary.group_size ?? 2,
    budget_tier: itinerary.budget_tier ?? "mid",
  };
}
```

---

## 4. Files / Functions to Change

### Frontend

| File | Change |
|------|--------|
| `apps/web/src/pages/ItineraryResults.tsx` | Add `refreshing` state; add Refresh button (disabled when `refreshing`); add `deriveSearchParams(itinerary, result_json)`; add `handleRefresh`: derive params → fetchSearch → fetch generate-itinerary with `itinerary_id` + `search_results` → on success refetch itinerary and toast; on error toast and re-enable. |

### Backend

| File | Change |
|------|--------|
| `apps/web/supabase/functions/generate-itinerary/index.ts` | Add refresh branch at top: if `body.itinerary_id` and `body.payload?.search_results` (or `body.search_results`), fetch itinerary, use request search_results, **keep existing share_slug**, run LLM, parse. **Only on success**: `UPDATE itineraries SET result_json, status, updated_at`. On any error, return 4xx/5xx and do not UPDATE. |

### Unchanged

- `apps/web/supabase/functions/search/index.ts` — no changes.
- Database — no migration.

---

## 5. Edge Cases by Entry Flow

| Flow | Edge case | Mitigation |
|------|-----------|------------|
| Artist + city | `event_details` is genre text, not artist | Heuristic: if starts with "genres:" or length &gt; 80, omit artist; search by city only |
| Artist + city | `event_details` empty | Search by city only |
| Discover | No events in result_json | Fall back to itinerary.city, no artist |
| Discover | Different events per tier | Use first package's first event; may not match original pick exactly |
| Flexible | No events (malformed result) | Use city = "Austin" |
| All | `start_date` / `end_date` missing | Do not call refresh; show error "Cannot refresh: missing dates" |
| All | Search returns empty | Still call generate-itinerary; LLM will use fallback mock data |

---

## 6. Manual Test Steps

### Happy path — artist + city

1. Generate itinerary: “Luke Combs” + Nashville, dates 2+ weeks out.
2. Open itinerary. Note “Generated” time and a hotel name.
3. Click **Refresh**. Confirm button is disabled and “Refreshing…” appears.
4. Wait for completion. Confirm toast “Refresh complete”, new “Generated” time, and packages may have changed.
5. Copy share link, open in incognito. Confirm same refreshed content.

### Happy path — discover

1. Use “Show me the best upcoming shows” → pick a concert → build trip.
2. Open itinerary. Click **Refresh**.
3. Confirm refresh completes; share link unchanged.

### Happy path — flexible

1. Use “I'm flexible” → generate.
2. Open itinerary. Click **Refresh**.
3. Confirm refresh completes; city inferred from first event or Austin.

### Failure — network

1. Open itinerary. In DevTools → Network, set “Offline”.
2. Click **Refresh**. Confirm error toast; itinerary unchanged; Refresh button re-enabled.
3. Go back online. Click **Refresh** again. Confirm success.

### Failure — backend error

1. (If testable) Temporarily break generate-itinerary or use an invalid itinerary_id.
2. Click **Refresh**. Confirm error toast; itinerary unchanged.

### Regression — new itinerary

1. Create a **new** itinerary from Experience Builder (do not use Refresh).
2. Confirm redirect to share link and packages load. Confirm create flow is unchanged.

---

## 7. What Explicitly Waits Until Phase 2

- **“What changed” diff UI** — Before/after comparison.
- **search_context column** — Store artist/city/flow on create for more accurate refresh.
- **Refresh history or audit log** — Track when refreshes occurred.
- **Scheduled / automatic refresh** — Background jobs.
- **Optimistic UI** — Do not show new content until backend confirms; Phase 1 stays “fetch → then update.”
