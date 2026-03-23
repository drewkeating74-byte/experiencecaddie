# Golf Catalog Phase 1A — Smallest Shippable Implementation Plan

**Created:** March 2025  
**Goal:** Ship the minimum useful version of a canonical golf catalog so Experience Caddie uses a trusted DB pool for strong markets before falling back to live Google search.

---

## Revised Phase 1A Recommendation (March 2025)

**1. DB-first threshold — tier-aware**
- Do not use DB path if a metro has only a few courses or all courses in one tier.
- Require **at least 8 active likely-public courses** AND **at least 2 distinct tiers** (gold/silver/bronze).
- Implementation: After querying DB, compute `distinctTiers` from `tier_hint` (or inferred tier); use DB path only if `count >= 8 && distinctTiers >= 2`.

**2. Add `excluded_reason` now**
- Add nullable `excluded_reason` to schema.
- When `active = false`, set `excluded_reason` to record why: `private`, `closed`, `seasonal`, `duplicate`, `low_quality`, `other`.
- Supports manual curation (e.g. mark private courses) and future cleanup (e.g. find seasonals to reactivate).
- Seed script: omit or set null for new seeds.

**Implementation order unchanged** — migration, search flow, seed script. Threshold and `excluded_reason` are additive changes.

---

## Practical Recommendation First

**Do this:** Add a few columns to the existing `golf_courses` table (including `excluded_reason` for curation), seed 30–50 public courses across Phoenix, Nashville, and Austin, then change the search flow to look up the DB first. Use DB path only when the metro has **at least 8 active likely-public courses** and **at least 2 distinct tiers** (gold/silver/bronze) represented — this keeps Bronze/Silver/Gold reliable and avoids thin pools. Otherwise, keep the current live Google search path.

**Don’t do yet:** Admin UI for golf, automatic refresh jobs, metro auto-mapping, Vegas/Dallas/Denver. Keep Phase 1A small and shippable.

---

## 1. Schema / Migration

### Fields to add

Use existing columns where possible: `name`, `place_id`, `source`, `source_id`, `city`, `state`, `lat`, `lng`, `booking_url`, `rating`.

Add only what’s needed for a trusted pool:

| Column | Type | Purpose |
|--------|------|---------|
| `metro` | TEXT | Metro grouping (e.g. "Phoenix", "Nashville", "Austin") |
| `canonical_name` | TEXT | Display name; default from `name` |
| `public_access_confidence` | TEXT | 'likely_public' \| 'unknown' \| 'likely_private' |
| `normalized_quality_score` | INTEGER | 0–100 for ranking |
| `tier_hint` | TEXT | 'bronze' \| 'silver' \| 'gold' |
| `editorial_boost` | INTEGER DEFAULT 0 | Optional bump for standout courses |
| `active` | BOOLEAN DEFAULT true | Include in search when true |
| `last_verified_at` | TIMESTAMPTZ | When we last confirmed (optional for 1A) |
| `excluded_reason` | TEXT, nullable | Reason when `active = false`; see below |

**`active` + `excluded_reason` together:**
- `active = true` → course is included in search; `excluded_reason` should be null.
- `active = false` → course is excluded from search. Use `excluded_reason` to record why for manual curation and future cleanup.
- Suggested values: `private`, `closed`, `seasonal`, `duplicate`, `low_quality`, `other`.
- Manual curation: Set `active = false` and `excluded_reason = private` when you discover a course is private. Future re-seed scripts can skip re-adding.
- Future cleanup: Query `WHERE active = false AND excluded_reason = seasonal` to find seasonals for reactivation. Add `excluded_reason` “private” vs “closed” vs “seasonal”.

### Migration SQL

```sql
-- Phase 1A: Canonical golf catalog — minimum fields for trusted pool
ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS metro TEXT,
  ADD COLUMN IF NOT EXISTS canonical_name TEXT,
  ADD COLUMN IF NOT EXISTS public_access_confidence TEXT
    CHECK (public_access_confidence IS NULL OR public_access_confidence IN ('likely_public', 'unknown', 'likely_private')),
  ADD COLUMN IF NOT EXISTS normalized_quality_score INTEGER,
  ADD COLUMN IF NOT EXISTS tier_hint TEXT
    CHECK (tier_hint IS NULL OR tier_hint IN ('bronze', 'silver', 'gold')),
  ADD COLUMN IF NOT EXISTS editorial_boost INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS excluded_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_golf_courses_metro_active
  ON public.golf_courses (metro, state)
  WHERE active = true AND (source = 'google_places' OR source_id IS NOT NULL);
```

---

## 2. Seed Approach

### Minimum dataset (30–50 courses)

| Metro | City values in seed | Target count | Rationale |
|-------|---------------------|--------------|-----------|
| Phoenix | Phoenix, Scottsdale, Tempe, Mesa, Gilbert | 15–20 | Largest golf market |
| Nashville | Nashville, Franklin, Brentwood | 10–12 | Strong music + golf |
| Austin | Austin, Round Rock, Cedar Park | 10–12 | Live music hub |

### How to prepare seed data with least effort

**Step 1: Generate candidates with current search**

1. Run Experience Caddie search for Phoenix, Nashville, Austin (artist + city or discover flow).
2. In browser Network tab or Supabase logs, capture the `golf_courses` array from the search response.
3. Export to JSON (or copy into a sheet). Each item has: `id` (Place ID), `name`, `city`, `state`, `lat`, `lng`, `public_access_confidence`, `tier_hint`, `quality_score`.

**Step 2: Clean and filter**

1. Remove any with `public_access_confidence === 'likely_private'`.
2. Keep only `likely_public` or `unknown` (for unknown, spot-check names).
3. Drop duplicates by Place ID.
4. For each course, set:
   - `metro` = "Phoenix" | "Nashville" | "Austin" (based on city/state)
   - `canonical_name` = `name` (or cleaned name)
   - `source` = `google_places`
   - `source_id` = Place ID (e.g. `ChIJ...` or `places/ChIJ...`)

**Step 3: Seed via SQL or script**

- Option A: Build a JSON/CSV and run an `INSERT` script.
- Option B: Extend `scripts/seed.mjs` with a `seedGolfCatalog()` that reads a JSON file and upserts by `(source, source_id)`.

**Practical recommendation:** Create `scripts/seed-golf-catalog.mjs` that:

1. Reads `scripts/data/golf-catalog-phase1a.json` (you populate this from Step 1–2).
2. For each row: `INSERT ... ON CONFLICT (source, source_id) DO UPDATE` (requires unique index on `(source, source_id)` — already exists).
3. Populate: `name`, `canonical_name`, `city`, `state`, `metro`, `lat`, `lng`, `place_id`, `source`, `source_id`, `public_access_confidence`, `normalized_quality_score`, `tier_hint`, `active`, `excluded_reason` (null for new seeds), `holes` (18).

---

## 3. Search Flow Integration

### DB-first logic

```
1. Resolve search center (geocode city or use venue lat/lng) — unchanged.
2. Map city to metro:
   - Phoenix, Scottsdale, Tempe, Mesa, Gilbert → "Phoenix"
   - Nashville, Franklin, Brentwood → "Nashville"
   - Austin, Round Rock, Cedar Park → "Austin"
   - Else → no DB lookup (use live only)
3. Query DB: golf_courses WHERE metro = ? AND state = ? AND active = true
   AND public_access_confidence IN ('likely_public', 'unknown')
   AND source_id IS NOT NULL
4. Count courses and distinct tiers (gold/silver/bronze) in results.
5. If count >= 8 AND distinct tiers >= 2 → use DB path.
6. Else → use existing live Google search (current behavior).
```

### Definition of “DB has enough”

Use **8 courses and 2 distinct tiers** (tier-aware threshold; see implementation below) — minimum 8 courses and at least 2 distinct tiers (gold/silver/bronze). Implementation: compute `distinctTiers` from results; use DB path only if `results.length >= 8 && distinctTiers >= 2`. That’s enough to fill Bronze/Silver/Gold pools (with fallback) and justify trusting the DB over live search.

### Metro mapping (Phase 1A — hardcoded)

```typescript
const CITY_TO_METRO: Record<string, string> = {
  phoenix: "Phoenix", scottsdale: "Phoenix", tempe: "Phoenix", mesa: "Phoenix", gilbert: "Phoenix",
  nashville: "Nashville", franklin: "Nashville", brentwood: "Nashville",
  austin: "Austin", "round rock": "Austin", "cedar park": "Austin",
};
```

---

## 4. Ranking Behavior (Phase 1A)

### From DB pool

1. **Filter:** `active = true`, `public_access_confidence IN ('likely_public', 'unknown')`. Exclude `likely_private`.
2. **Sort:** `normalized_quality_score DESC`, then `editorial_boost DESC`, then distance from center.
3. **Tiers:** Use `tier_hint` from DB. If null, infer from `normalized_quality_score`:
   - gold: score >= 70
   - silver: 50 <= score < 70
   - bronze: score < 50
4. **Pools:** Max 5 per tier. Keep existing Gold→Silver→Bronze fallback when a pool is empty.
5. **Private / questionable:** Only seed `likely_public` courses. DB filter excludes `likely_private`. Live fallback keeps current `applyQualityPreFilter`.

---

## 5. Exact Implementation Plan

### Files to create or change

| File | Change |
|------|--------|
| `apps/web/supabase/migrations/YYYYMMDD_golf_catalog_phase1a.sql` | New migration (schema above) |
| `apps/web/scripts/data/golf-catalog-phase1a.json` | Seed data (you populate from search output) |
| `apps/web/scripts/seed-golf-catalog.mjs` | New script: read JSON, upsert golf_courses |
| `apps/web/supabase/functions/search/index.ts` | Add DB lookup, metro mapping, conditional DB vs live |

### Smallest implementation steps

| Step | Task | Est. |
|------|------|------|
| **1** | Create migration `YYYYMMDD_golf_catalog_phase1a.sql` with new columns and index. Run `supabase db push` or apply migration. | 15 min |
| **2** | Add `CITY_TO_METRO` and `findGolfFromDb(supabase, metro, state)` in search. Query: `SELECT * FROM golf_courses WHERE metro = $1 AND state = $2 AND active = true AND public_access_confidence IN ('likely_public','unknown') AND source_id IS NOT NULL ORDER BY normalized_quality_score DESC NULLS LAST`. Return up to 15 rows. | 30 min |
| **3** | Add `enrichDbCoursesWithPlaceDetails(dbCourses, googleKey)` — for each course with `source_id`, call Place Details; merge `rating`, `user_rating_count`, `websiteUri`, `googleMapsUri` into `GolfCourseResult`. | 30 min |
| **4** | Add `dbCoursesToGolfCourseResults(dbCourses, centerLat, centerLng)` — map DB rows to `GolfCourseResult`, compute `distance_miles`, use DB `tier_hint` / `normalized_quality_score`. | 20 min |
| **5** | In main search handler: after `resolveGolfCenter()`, compute `metro` from city. If metro exists, call `findGolfFromDb`. Compute `distinctTiers` from results. If `results.length >= 8 && distinctTiers >= 2`, enrich, convert to results, build pools, use them. Else, run existing `searchGolfGooglePlaces` path. | 30 min |
| **6** | Create `seed-golf-catalog.mjs` and `golf-catalog-phase1a.json`. Run search for Phoenix/Nashville/Austin, export golf results, clean, add metro/tier/score, save to JSON. Run seed script. | 45 min |

### What to postpone to Phase 1B or later

| Item | Why later |
|------|-----------|
| Admin UI for golf | Seed + JSON is enough for 1A |
| Automatic refresh / `last_verified_at` | Manual re-seed when needed |
| Metro auto-discovery (e.g. geocode → metro) | Hardcoded mapping is fine for 3 metros |
| Vegas, Dallas, Denver | Add after 1A is stable |
| PostGIS / radius query | Filter by metro+state; haversine in app for distance sort |

---

## 6. Manual Test Plan

### Strong market (DB path)

1. Search for a concert in **Phoenix** or **Scottsdale** (e.g. artist + Phoenix, dates 2+ weeks out).
2. Generate itinerary.
3. **Expect:** Golf courses come from the DB. Check that names and cities look like Phoenix-area courses (e.g. Papago, Troon North if seeded). Bronze/Silver/Gold each have golf.
4. **Sanity check:** In Supabase, run `SELECT metro, COUNT(*) FROM golf_courses WHERE active = true GROUP BY metro` and confirm Phoenix has ≥ 8 and at least 2 tiers.

### Strong market — Nashville

1. Search for **Nashville** (artist + Nashville or discover).
2. **Expect:** Golf from DB. Nashville-area public courses. All three tiers have golf.

### Strong market — Austin

1. Search for **Austin**.
2. **Expect:** Same as above for Austin.

### Thin market (live fallback)

1. Search for a city **not** in Phoenix/Nashville/Austin (e.g. **Denver**, **Atlanta**, **Las Vegas**).
2. **Expect:** Golf comes from live Google search (same as today). No errors. Tiering may be less consistent but should still return results.

### No center (flexible location)

1. Use “I’m flexible” with no city.
2. **Expect:** No metro; live search or mock. Behavior unchanged from today.

---

## Not Now / Later

| Do not build in Phase 1A |
|--------------------------|
| Admin UI for golf CRUD |
| Automated sync/refresh job |
| Metro from geocoding or external API |
| Vegas, Dallas, Denver, Atlanta seeds |
| PostGIS or complex geo queries |
| Caching layer for Place Details |

---

## Summary

| Phase 1A deliverable | Description |
|----------------------|-------------|
| **Schema** | Add `metro`, `canonical_name`, `public_access_confidence`, `normalized_quality_score`, `tier_hint`, `editorial_boost`, `active`, `last_verified_at`, `excluded_reason` |
| **Seed** | 30–50 courses for Phoenix, Nashville, Austin via JSON + script; `excluded_reason` null for new seeds |
| **Search** | DB-first when metro in map and DB has ≥ 8 courses and ≥ 2 tiers; else live Google |
| **Ranking** | Use DB tier_hint; filter `likely_private`; keep tier fallback logic |
| **Test** | Phoenix/Nashville/Austin use DB; other cities use live |
