-- Add verification_status to golf_courses.
--
-- Verification rules (enforced in search/index.ts findGolfFromDb):
--   verified     → eligible for packages, ranked normally
--   unreviewed   → eligible for packages (default for all existing rows)
--   needs_review → held back from packages; may appear in broad search with
--                  a reduced confidence signal if that feature is added later
--   excluded     → never shown to users under any circumstances
--
-- The active column remains the hard on/off switch. verification_status
-- adds a softer workflow state between "seen but not yet reviewed" and
-- "confirmed safe to show". A course must be active = true AND
-- verification_status IN ('verified', 'unreviewed') to appear in packages.

ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (verification_status IN ('verified', 'needs_review', 'excluded', 'unreviewed'));

COMMENT ON COLUMN public.golf_courses.verification_status IS
  'Workflow status set by manual or automated review. '
  'verified = confirmed good; unreviewed = new/unseen (shown by default); '
  'needs_review = flagged, held back from packages; excluded = never shown.';

-- Index for the common query pattern: active courses that are eligible for packages
CREATE INDEX IF NOT EXISTS idx_golf_courses_eligible
  ON public.golf_courses (metro, normalized_quality_score DESC)
  WHERE active = true
    AND verification_status IN ('verified', 'unreviewed')
    AND metro IS NOT NULL;
