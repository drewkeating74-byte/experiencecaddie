# Search/Discovery Regression Audit — Recovery Plan

**Incident:** Search and discovery capability has regressed. Refresh fails, prices missing, broad discovery weaker, Gold tier questionable.

**Audit date:** 2025-03-20

---

## 1. Plain-English Diagnosis

### Most Likely Regression Causes

| Symptom | Root cause | Confidence |
|---------|------------|------------|
| **Refresh: missing start_date/end_date** | `toYYYYMMDD()` may not handle the format PostgREST returns (e.g. date as number/timestamp, or wrapped structure). Alternatively, the itinerary being tested was created via a path that didn't persist dates, or the fetch response structure differs from expectation. | Medium |
| **Missing hotel/ticket prices** | The LLM never receives price data. `realDataSection` passes only `{ name, venue, date, url }` for concerts and `{ name, url }` for hotels — no `price_min`, `price_max`, or `price_per_night`. The LLM must invent or search; it often omits them. | **High** |
| **Weaker "show me best shows" / "I'm flexible"** | For **I'm flexible**: `(hasArtist \|\| hasCity)` is false → we **skip fetchSearch entirely** and use `buildFallbackSearchResponse` with Austin. No Ticketmaster, no Google Places — pure mock data. For **best shows**: User picks a concert (real city) → we DO call fetchSearch. But if Ticketmaster key is missing or TM fails, we fall back to mock. | **High** |
| **Questionable Gold-tier outputs** | Golf catalog Phase 1A added DB-first path for Phoenix/Nashville/Austin. When DB is used, Gold pool can be empty → we fall back to Silver (or Bronze). DB seed may have weak Gold-tier courses, or tier assignment (`inferTierFromScore`, `tier_hint`) is misaligned. | Medium |

---

## 2. Recent Changes / Logic Paths That Explain Symptoms

### 2a. Missing Dates in Refresh

- **`deriveSearchParams`** uses `toYYYYMMDD(itinerary?.start_date)`.
- **`toYYYYMMDD`** handles: `string` (expects YYYY-MM-DD in first 10 chars), `Date` object. It does **not** handle:
  - Unix timestamp (number)
  - Date wrapped in object
  - ISO string with timezone that doesn't match regex
- **PostgREST** typically returns `date` as `"YYYY-MM-DD"` — but config or client can change this.
- **Possible bug:** If the client receives `start_date` as a number (ms since epoch) or in a different shape, `toYYYYMMDD` returns `null`.

### 2b. Missing Hotel/Ticket Prices

- **Search** returns `price_min`, `price_max` on events and hotels (Ticketmaster `priceRanges`, mock data).
- **generate-itinerary** `realDataSection` (lines 457, 464):
  - Concerts: `{ name, venue, date, url }` — **omits** `price_min`, `price_max`
  - Hotels: `{ name, url }` — **omits** `price_min`, `price_max`
- LLM schema asks for `price_range` (events) and `price_per_night` (lodging) but gets no source data → often omits or invents.

### 2c. Weaker Broad Discovery

- **ExperienceBuilder** (lines 396–408):
  - `hasCity = finalCity !== "flexible"` → for "I'm flexible", `hasCity` is false.
  - `(hasArtist || hasCity)` → for surprise/flexible, both false.
  - Result: **No fetchSearch**; uses `buildFallbackSearchResponse` with Austin → mock only.
- **search/index.ts** (lines 1033–1036):
  - `shouldCallTicketmaster = hasKey && (artist OR (city AND city !== "flexible"))`
  - For flexible, `city` is "flexible" → TM is never called; mock events used.

### 2d. Questionable Gold-Tier Golf

- **Golf catalog Phase 1A** (`1f9fac6`): DB-first path for Phoenix, Nashville, Austin.
- `dbMeetsThreshold` requires 8+ courses and 2+ tiers.
- `goldPool` comes from DB `tier_hint` or `inferTierFromScore` (score ≥ 70 = gold).
- If Gold pool is empty → `golfGold = golfSilver ?? golfBronze ?? golfUnassigned` (line 450).
- DB seed may have too few Gold-tier courses → Gold package gets Silver/Bronze golf.

---

## 3. Fastest Recovery Plan

### Priority: Restore Known-Good Behavior

| Flow | Goal |
|------|------|
| **Artist + city** | Real TM events, real Google golf, prices in output |
| **Show me the best upcoming shows** | Perplexity discover → user picks → real search for that city |
| **I'm flexible** | Real search (not just Austin mock) — e.g. call TM with a default city or Perplexity-discovered city |

---

## 4. Exact Files / Functions to Patch First

| File | Function / area | Fix |
|------|------------------|-----|
| **generate-itinerary/index.ts** | `realDataSection` (lines 456–464) | Include `price_min`, `price_max` in concert and hotel objects passed to LLM. Add explicit instruction: "Include price_range (e.g. '$75–$250') for events and price_per_night for lodging using the provided price data." |
| **ExperienceBuilder.tsx** | `handleSubmit` search branch (lines 396–408) | For flexible: **call fetchSearch** with city `"Austin"` (or a rotated default) instead of skipping. Ensures real TM + golf when possible. |
| **search/index.ts** | `shouldCallTicketmaster` (lines 1033–1036) | When city is "flexible" or missing: pass a default city (e.g. Austin) to TM for broad discovery, instead of skipping to mock. |
| **ItineraryResults.tsx** | `toYYYYMMDD` | Add handling for: (1) numeric timestamp, (2) object with `.date` or ISO string property. Add defensive `String(val).slice(0,10)` fallback for unexpected string formats. |

---

## 5. Recommended Order

### Immediate (fix first)

1. **Add prices to LLM prompt** — `generate-itinerary` realDataSection: include `price_min`/`price_max` for events and hotels. Instruct LLM to use them for `price_range` and `price_per_night`.
2. **Flexible flow: call real search** — ExperienceBuilder: for flexible, call `fetchSearch` with `destination: { city: "Austin" }` (or similar) instead of `buildFallbackSearchResponse` only.
3. **Search: flexible city fallback** — When `city === "flexible"` or missing, use a default city (e.g. Austin) for Ticketmaster so we get real events instead of mock.
4. **Refresh dates: robust toYYYYMMDD** — Support numeric timestamps and unexpected formats; add `String(val)` fallback for edge cases.

### Temporarily disable or roll back (if needed)

1. **Refresh button** — If dates still fail after the above, **hide or disable the Refresh button** until a `search_context` column (or equivalent) stores dates at create time. This prevents user-facing errors.
2. **Golf catalog DB path** — If Gold outputs remain poor, consider a feature flag or env var to bypass `useDbPath` and use Google Places path only for pilot cities, until DB seed and tier logic are validated.

### Do not change (avoid new regressions)

- Perplexity discover flow (concert options → pick → build)
- Core TM and Google Places integration
- RLS and itinerary fetch logic

---

## 6. Manual Retest Steps

### Artist + city (Nashville)

1. Experience Builder → "I already know who I want to see" → artist: "Luke Combs", city: Nashville, dates 2+ weeks out.
2. Generate itinerary.
3. **Check:** Events have `price_range`, lodging has `price_per_night`, golf has `green_fee`. Share link works.
4. Click **Refresh** → success, no "missing dates" error. Timestamp updates.

### Show me the best upcoming shows

1. Experience Builder → "Show me the best upcoming shows" → pick dates.
2. Wait for concert options → pick one (e.g. Nashville).
3. Generate itinerary.
4. **Check:** Real TM-style events (not "Sample Concert"), prices shown. Golf and hotels look real.

### I'm flexible (Austin / Phoenix)

1. Experience Builder → "I'm flexible — show me something great" → pick dates.
2. Generate itinerary.
3. **Check:** Not mock-only. Should see real-ish events (via Austin or default city search), not just "Sample Concert" in every result.
4. Verify Golf tier distribution (Bronze/Silver/Gold) — Gold should have distinct, higher-quality options when available.

### Refresh after recovery

1. Open any itinerary with `start_date` and `end_date` in DB.
2. Click Refresh.
3. **Check:** No "missing dates" error; toast "Refresh complete"; Generated timestamp updates.

---

## 7. Refresh: Temporarily Disable?

**Recommendation:** If the date fix (robust `toYYYYMMDD` + fallback) does not resolve the issue after deployment:

1. **Hide the Refresh button** in ItineraryResults (e.g. `{false && <Button ... Refresh />}` or a feature flag).
2. Prioritize adding a `search_context` JSONB column (Phase 2) to store `{ start_date, end_date, artist, city }` at create time.
3. Re-enable Refresh once dates are reliably available.

---

## 8. Summary of Immediate Patches

| # | File | Change |
|---|------|--------|
| 1 | generate-itinerary/index.ts | Add `price_min`, `price_max` to CONCERTS and HOTELS in realDataSection; instruct LLM to use them |
| 2 | ExperienceBuilder.tsx | For flexible: call fetchSearch with city "Austin" (or default) instead of buildFallbackSearchResponse only |
| 3 | search/index.ts | When city is flexible/missing: use default city (Austin) for TM so real search runs |
| 4 | ItineraryResults.tsx | Harden toYYYYMMDD for numeric timestamps and edge formats |
| 5 | ItineraryResults.tsx (optional) | If dates still fail: hide Refresh button until search_context exists |
