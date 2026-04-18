-- Fix NULL verification_status on golf_courses (silent verifier no-op).
--
-- Cause: refresh-catalog upserts omit verification_status. After
-- 20260412200000_golf_verification_bulk_remediation.sql widened the CHECK
-- to allow NULL, new/updated catalog rows stayed NULL instead of defaulting
-- to 'unreviewed', so verify-golf-courses Pass 1 matched zero rows.
--
-- This migration: backfill → guard trigger → NOT NULL + tight CHECK.

-- 1) Backfill every NULL to a valid workflow state
UPDATE public.golf_courses
SET verification_status = 'unreviewed'
WHERE verification_status IS NULL;

-- 2) Trigger: never allow NULL going forward (INSERT or UPDATE from catalog)
CREATE OR REPLACE FUNCTION public.golf_courses_fill_verification_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.verification_status IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verification_status := 'unreviewed';
    ELSE
      -- UPDATE: preserve prior status if client omitted the column (NULL payload)
      NEW.verification_status := COALESCE(OLD.verification_status, 'unreviewed');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_golf_courses_verification_status_guard ON public.golf_courses;

CREATE TRIGGER trg_golf_courses_verification_status_guard
  BEFORE INSERT OR UPDATE ON public.golf_courses
  FOR EACH ROW
  EXECUTE FUNCTION public.golf_courses_fill_verification_status();

COMMENT ON FUNCTION public.golf_courses_fill_verification_status() IS
  'Ensures verification_status is never NULL: new rows default to unreviewed; '
  'updates that send NULL preserve the previous status (catalog upsert safety).';

-- 3) Tighten CHECK (disallow NULL) and enforce NOT NULL
ALTER TABLE public.golf_courses
  DROP CONSTRAINT IF EXISTS golf_courses_verification_status_check;

ALTER TABLE public.golf_courses
  ADD CONSTRAINT golf_courses_verification_status_check
  CHECK (
    verification_status = ANY (
      ARRAY['verified'::text, 'unreviewed'::text, 'needs_review'::text, 'excluded'::text]
    )
  );

ALTER TABLE public.golf_courses
  ALTER COLUMN verification_status SET DEFAULT 'unreviewed';

ALTER TABLE public.golf_courses
  ALTER COLUMN verification_status SET NOT NULL;
