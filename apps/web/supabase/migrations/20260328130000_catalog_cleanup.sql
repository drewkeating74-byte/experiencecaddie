-- =============================================================================
-- Catalog cleanup: remove unused legacy columns + clear old seed data
-- Branch: catalog-20-cities
-- =============================================================================
-- Run this in Supabase SQL Editor BEFORE running refresh-catalog with
-- dry_run: false. It drops columns that were never queried by any Edge Function
-- and deletes hand-entered seed rows so the refresh function starts clean.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. golf_courses — drop unused legacy columns
-- -----------------------------------------------------------------------------
-- destination_id: was a FK to the destinations table; the search flow never
--   joins to destinations and the catalog approach doesn't need it.
ALTER TABLE public.golf_courses DROP COLUMN IF EXISTS destination_id;

-- guest_policy: free-text field that was never populated or queried.
--   public_access_confidence is the structured replacement.
ALTER TABLE public.golf_courses DROP COLUMN IF EXISTS guest_policy;

-- slope: golf handicap stat; not used in any search, scoring, or display logic.
ALTER TABLE public.golf_courses DROP COLUMN IF EXISTS slope;

-- description: free-text; never queried. The LLM generates its own descriptions
--   from the course name, rating, and tier — a static DB description adds noise.
ALTER TABLE public.golf_courses DROP COLUMN IF EXISTS description;


-- -----------------------------------------------------------------------------
-- 2. venues — drop unused legacy columns
-- -----------------------------------------------------------------------------
-- destination_id: same reason as golf_courses — never joined on.
ALTER TABLE public.venues DROP COLUMN IF EXISTS destination_id;


-- -----------------------------------------------------------------------------
-- 3. Clear old seed / placeholder data
-- -----------------------------------------------------------------------------
-- Delete rows that were hand-entered (source IS NULL) or are mock/placeholder
-- rows (name contains 'Mock' or 'Sample'). Rows loaded by the refresh function
-- always have source = 'google_places' or 'ticketmaster', so they are safe.
--
-- golf_courses
DELETE FROM public.golf_courses
WHERE source IS NULL
   OR name ILIKE '%mock%'
   OR name ILIKE '%sample%'
   OR name ILIKE '%placeholder%'
   OR name ILIKE '%test%';

-- venues
DELETE FROM public.venues
WHERE source IS NULL
   OR name ILIKE '%mock%'
   OR name ILIKE '%sample%'
   OR name ILIKE '%placeholder%'
   OR name ILIKE '%test%';

-- -----------------------------------------------------------------------------
-- 5. Fix venues unique constraint for upserts
--    PostgREST's ON CONFLICT requires a proper UNIQUE CONSTRAINT, not just
--    a partial unique index. Drop the partial index and add a real constraint.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS idx_venues_source_id;

ALTER TABLE public.venues
  ADD CONSTRAINT IF NOT EXISTS venues_source_source_id_unique UNIQUE (source, source_id);
-- -----------------------------------------------------------------------------
-- After running, paste these into a new SQL Editor tab to check row counts:
--
--   SELECT count(*), source FROM public.golf_courses GROUP BY source;
--   SELECT count(*), source FROM public.venues       GROUP BY source;
--
-- Both should return 0 rows (empty) until you run the refresh function.
-- Column list should no longer show destination_id, guest_policy, slope,
-- or description on golf_courses, and no destination_id on venues.
