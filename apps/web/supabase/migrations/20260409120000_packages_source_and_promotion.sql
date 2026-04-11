-- Extend packages table to support two sources:
--
--   curated   → manually seeded editorial packages (all existing rows)
--   promoted  → user-generated itineraries auto-promoted when 2+ distinct
--               users save the same itinerary
--
-- Promoted packages don't have FK references to events/golf_courses/destinations
-- (those rows may not exist). Instead they carry denormalized text fields that
-- the browse page falls back to when the FK join returns null.

ALTER TABLE public.packages
  -- Which pipeline created this package
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'curated'
    CHECK (source IN ('curated', 'promoted')),

  -- The itinerary row this was promoted from (null for curated packages)
  ADD COLUMN IF NOT EXISTS source_itinerary_id UUID
    REFERENCES public.itineraries(id) ON DELETE SET NULL,

  -- When a user-generated itinerary was promoted to this catalog row
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ,

  -- Cached count of distinct users who saved the source itinerary (used for ranking)
  ADD COLUMN IF NOT EXISTS save_count INTEGER NOT NULL DEFAULT 0,

  -- Denormalized fields used when event_id / golf_course_id / destination_id are null
  ADD COLUMN IF NOT EXISTS event_name       TEXT,
  ADD COLUMN IF NOT EXISTS event_date       DATE,
  ADD COLUMN IF NOT EXISTS artist_name      TEXT,
  ADD COLUMN IF NOT EXISTS golf_course_name TEXT,
  ADD COLUMN IF NOT EXISTS city             TEXT;

COMMENT ON COLUMN public.packages.source IS
  'curated = manually seeded; promoted = auto-promoted from a popular user itinerary';
COMMENT ON COLUMN public.packages.source_itinerary_id IS
  'The itinerary this package was promoted from. Null for curated packages.';
COMMENT ON COLUMN public.packages.save_count IS
  'Number of distinct users who saved the source itinerary. Used for sorting promoted packages.';
COMMENT ON COLUMN public.packages.event_name IS
  'Denormalized event name for promoted packages that lack an event_id FK.';
COMMENT ON COLUMN public.packages.event_date IS
  'Denormalized event date for promoted packages. Also used by the daily cleanup job.';
COMMENT ON COLUMN public.packages.artist_name IS
  'Denormalized artist name for promoted packages.';
COMMENT ON COLUMN public.packages.golf_course_name IS
  'Denormalized golf course name for promoted packages.';
COMMENT ON COLUMN public.packages.city IS
  'Denormalized city for promoted packages that lack a destination_id FK.';

-- Unique constraint: one promoted package per source itinerary
CREATE UNIQUE INDEX IF NOT EXISTS idx_packages_source_itinerary
  ON public.packages (source_itinerary_id)
  WHERE source_itinerary_id IS NOT NULL;

-- Index for the daily cleanup query (find active packages with past dates)
CREATE INDEX IF NOT EXISTS idx_packages_event_date_active
  ON public.packages (event_date)
  WHERE active = true AND event_date IS NOT NULL;
