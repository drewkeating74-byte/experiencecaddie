# Phase 1A Golf Catalog — Validation Guide

**Goal:** Determine whether the seeded DB-first golf results for Phoenix/Scottsdale, Nashville, and Austin are improving package quality and trust.

---

## 1. Manual Validation Checklist by Metro

Use this checklist for **Phoenix/Scottsdale**, **Nashville**, and **Austin** separately.

### Bronze / Silver / Gold expectations

| Tier | Expectation |
|------|-------------|
| **Gold** | 1–5 courses; premium public courses (resorts, top municipal, well-rated). Names like TPC Scottsdale, Papago, Gaylord Springs, Omni Barton Creek. No private/country clubs. |
| **Silver** | 1–5 courses; solid mid-tier public. Good value, strong reviews. |
| **Bronze** | 1–5 courses; budget-friendly or value plays. Municipal, city courses, community. |

### What counts as a **good result**

- All three tiers have at least one golf option.
- Gold tier courses are recognizable public/resort names (not country clubs).
- Silver and Bronze feel distinct (Silver = nicer, Bronze = value).
- Course names match the metro (e.g. Phoenix shows Papago, Scottsdale courses, not Tucson).
- Tee time / booking links work and go to reasonable destinations (course site, GolfNow, Google Maps).
- No "Members Only", "Country Club", or "Private" in Gold or Silver.

### What counts as a **questionable result**

- Gold tier includes a course that sounds private (e.g. "XYZ Country Club").
- All tiers feel similar (e.g. mostly municipal).
- Courses from outside the metro (e.g. Tucson when searching Phoenix).
- A tier is empty and we're relying on fallback (acceptable but not ideal).
- Many courses have `public_access_confidence = 'unknown'` and names are ambiguous.

### What counts as a **fail**

- Gold tier shows a known private course.
- No golf at all for a strong metro (Phoenix, Nashville, Austin).
- Broken or irrelevant links.
- Courses with obviously wrong city/state (e.g. Denver course in Phoenix results).
- Search errors or infinite loading when using DB path.

---

## 2. Seed-Quality Review Approach

### How to inspect seeded records

1. **Supabase Dashboard** → Table Editor → `golf_courses` → filter by `metro` and `active = true`.
2. Export to CSV and review name, city, `public_access_confidence`, `tier_hint`, `normalized_quality_score`.

### SQL queries to identify risky records

**Weak entries (low score, no tier, or unknown access):**

```sql
SELECT id, name, city, state, metro, public_access_confidence, tier_hint, normalized_quality_score
FROM golf_courses
WHERE active = true
  AND metro IN ('Phoenix', 'Nashville', 'Austin')
  AND (
    normalized_quality_score < 40
    OR tier_hint IS NULL
    OR public_access_confidence = 'unknown'
  )
ORDER BY metro, normalized_quality_score NULLS LAST;
```

**Possible duplicates (similar names, same city):**

```sql
SELECT name, city, metro, COUNT(*) as cnt
FROM golf_courses
WHERE active = true
  AND metro IN ('Phoenix', 'Nashville', 'Austin')
GROUP BY name, city, metro
HAVING COUNT(*) > 1;
```

**Names that suggest private (manual spot-check):**

```sql
SELECT id, name, city, metro, public_access_confidence, tier_hint
FROM golf_courses
WHERE active = true
  AND metro IN ('Phoenix', 'Nashville', 'Austin')
  AND (
    name ILIKE '%country club%'
    OR name ILIKE '%private club%'
    OR name ILIKE '%members only%'
    OR name ILIKE '%athletic club%'
    OR name ILIKE '%golf & country%'
  );
```

**Overuse of `unknown` (should be mostly `likely_public`):**

```sql
SELECT metro, public_access_confidence, COUNT(*) as cnt
FROM golf_courses
WHERE active = true
  AND metro IN ('Phoenix', 'Nashville', 'Austin')
  AND source_id IS NOT NULL
GROUP BY metro, public_access_confidence
ORDER BY metro, public_access_confidence;
```

If `unknown` is more than ~30% of a metro’s active courses, consider spot-checking names and updating to `likely_public` or `likely_private`.

**Tier and count summary (DB-first threshold check):**

```sql
SELECT
  metro,
  state,
  COUNT(*) as total,
  COUNT(DISTINCT tier_hint) as tier_count,
  COUNT(*) FILTER (WHERE tier_hint = 'gold') as gold,
  COUNT(*) FILTER (WHERE tier_hint = 'silver') as silver,
  COUNT(*) FILTER (WHERE tier_hint = 'bronze') as bronze
FROM golf_courses
WHERE active = true
  AND public_access_confidence IN ('likely_public', 'unknown')
  AND source_id IS NOT NULL
  AND metro IN ('Phoenix', 'Nashville', 'Austin')
GROUP BY metro, state;
```

Each metro should have `total >= 8` and `tier_count >= 2` for DB-first to activate.

---

## 3. Practical Cleanup Plan

No admin UI needed. Use SQL or a one-off script.

### When to adjust fields

| Situation | Action |
|-----------|--------|
| Private course slipped in | `UPDATE golf_courses SET active = false, excluded_reason = 'private' WHERE id = '...';` |
| Duplicate | Deactivate one: `active = false, excluded_reason = 'duplicate'` |
| Wrong tier (e.g. municipal in Gold) | `UPDATE ... SET tier_hint = 'silver', normalized_quality_score = 55 WHERE ...;` |
| Should be Gold but in Silver | `UPDATE ... SET tier_hint = 'gold', normalized_quality_score = 75, editorial_boost = 5 WHERE ...;` |
| Too many `unknown` | Spot-check names; set `public_access_confidence = 'likely_public'` or `'likely_private'` and `active = false` if private |
| Low-quality or closed | `active = false, excluded_reason = 'low_quality'` or `'closed'` |

### Smallest useful improvements without admin UI

1. **Run the risky-record queries** and fix obvious issues (private, duplicates).
2. **Bump a few standouts** with `editorial_boost = 5` or `10` so they rank higher.
3. **Export → edit → re-seed:** Export `golf_courses` to JSON, edit `tier_hint`, `normalized_quality_score`, `public_access_confidence` in bulk, then run a script that updates by `source_id`. (Or use `UPDATE` with `WHERE name = '...' AND city = '...'` if unique.)
4. **Re-run `--from-search`** after fixing search filters (e.g. exclude likely_private) to get a cleaner seed set.

### Example cleanup SQL

```sql
-- Deactivate a private course
UPDATE golf_courses
SET active = false, excluded_reason = 'private'
WHERE name ILIKE '%Some Country Club%' AND metro = 'Phoenix';

-- Promote a course to Gold
UPDATE golf_courses
SET tier_hint = 'gold', normalized_quality_score = 78, editorial_boost = 5
WHERE name = 'Papago Golf Course' AND city = 'Phoenix';
```

---

## 4. Regression Test Approach

### Compare DB-backed vs live-search behavior

1. **Capture live-search baseline (no DB path):**
   - Temporarily set DB threshold to something unreachable (e.g. `MIN_DB_COURSES = 99` in search) or use a city outside Phoenix/Nashville/Austin.
   - Search Phoenix, Nashville, Austin and save the `golf_courses` and tier pools from the response.
   - Restore normal threshold.

2. **Capture DB-backed results:**
   - With DB seeded and threshold at 8 courses / 2 tiers, search the same cities.
   - Save `golf_courses` and tier pools.

3. **Compare:**
   - Do DB results have fewer private-sounding courses?
   - Is tiering more consistent (Gold = premium public, Silver = mid, Bronze = value)?
   - Are course names and cities correct for the metro?

### Specific improvements to expect if Phase 1A is working

| Metric | Before (live) | After (DB) |
|--------|----------------|------------|
| Private courses in Gold/Silver | Occasional | None (we filter at seed and query) |
| Tier consistency | Variable | More stable (editorial tier_hint) |
| Course set | Changes per API call | Stable, curated set |
| Result quality | Depends on Places API | Driven by seed quality |

### Quick sanity check

- **Phoenix:** Search "Taylor Swift Phoenix" (or any artist) → generate itinerary → Gold should include recognizable Phoenix-area public/resort courses.
- **Nashville:** Same flow → Gaylord Springs, Hermitage, etc. for public options.
- **Austin:** Same flow → Barton Creek (if public), Lions, etc.

If results look better (fewer private, clearer tiers) than a Denver or Atlanta search (live path), Phase 1A is adding value.
