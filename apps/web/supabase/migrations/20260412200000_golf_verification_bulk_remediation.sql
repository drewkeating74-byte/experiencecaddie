-- Golf courses: fix check constraint + bulk verification remediation
-- 2026-04-12
--
-- Problem 1 — constraint mismatch
-- The production check constraint on verification_status uses a different
-- value set ('verified','likely_verified','unclear','needs_review','excluded')
-- than the application code expects ('verified','unreviewed','needs_review','excluded').
-- findGolfFromDb() queries .in("verification_status", ["verified","unreviewed"]),
-- so 'unreviewed' rows could never exist and the DB-first catalog path returned
-- only the 5 manually-verified courses.
--
-- Fix: replace the constraint to match the codebase definition.
-- Current data has only 'verified' and 'needs_review' rows — no remapping needed.
--
-- Problem 2 — bulk over-flagging
-- 110 of 115 courses are in needs_review (95.7%), including 90 that are
-- already public_access_confidence = 'likely_public'. This blocks all DB-first
-- metro results except for the 5 verified rows.
--
-- Fix: move likely_public + needs_review + active = true → unreviewed.
-- 'unreviewed' = "not yet manually confirmed, but passes heuristics — eligible
-- for packages by default". Do NOT use 'verified' (that requires manual confirmation).
--
-- Courses staying in needs_review
-- --------------------------------
--   • 10 with public_access_confidence = 'likely_private' (e.g. Nashville Golf &
--     Athletic Club, Royal Oaks CC, Las Vegas CC, River Place CC, Westlake CC).
--     Name alone is not enough to exclude — flagged for admin dashboard review.
--   • 10 with public_access_confidence = 'unknown' — genuinely ambiguous names.

-- Step 1: drop old constraint
ALTER TABLE public.golf_courses
  DROP CONSTRAINT IF EXISTS golf_courses_verification_status_check;

-- Step 2: recreate with correct value set
ALTER TABLE public.golf_courses
  ADD CONSTRAINT golf_courses_verification_status_check
  CHECK (
    verification_status IS NULL
    OR verification_status = ANY (
      ARRAY['verified'::text, 'unreviewed'::text, 'needs_review'::text, 'excluded'::text]
    )
  );

-- Step 3: bulk-move likely_public + needs_review → unreviewed
UPDATE public.golf_courses
SET
  verification_status = 'unreviewed',
  last_verified_at    = NOW()
WHERE
  verification_status      = 'needs_review'
  AND public_access_confidence = 'likely_public'
  AND active = true;
