-- Phase 1A: Canonical golf catalog — minimum fields for trusted pool
-- See docs/GOLF_CATALOG_STRATEGY.md

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
