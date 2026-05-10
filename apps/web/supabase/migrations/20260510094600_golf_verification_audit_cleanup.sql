-- Golf verification cleanup: persist verifier metadata and add append-only audit history.
--
-- `golf_courses` remains the current canonical course snapshot. The new
-- `golf_course_verification_events` table stores the history/evidence an agent
-- or human used to change that snapshot.

-- 1) Columns already written by verify-golf-courses/index.ts.
ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS verification_method TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_by TEXT,
  ADD COLUMN IF NOT EXISTS last_agent_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_evidence_summary TEXT;

COMMENT ON COLUMN public.golf_courses.verification_method IS
  'Latest verifier method that set the current verification state.';
COMMENT ON COLUMN public.golf_courses.last_verified_by IS
  'Latest verifier actor/version or admin actor that changed verification state.';
COMMENT ON COLUMN public.golf_courses.last_agent_review_at IS
  'When an automated verifier last reviewed this course.';
COMMENT ON COLUMN public.golf_courses.verification_evidence_summary IS
  'Short human-readable evidence behind the current verification state.';

CREATE INDEX IF NOT EXISTS idx_golf_courses_last_agent_review
  ON public.golf_courses (last_agent_review_at)
  WHERE active = true;

-- 2) Align the course_type constraint with code paths that already treat
-- military courses as restricted and ineligible.
ALTER TABLE public.golf_courses
  DROP CONSTRAINT IF EXISTS golf_courses_course_type_check;

ALTER TABLE public.golf_courses
  ADD CONSTRAINT golf_courses_course_type_check
  CHECK (
    course_type IS NULL
    OR course_type = ANY (
      ARRAY[
        'public'::text,
        'semi_private'::text,
        'resort'::text,
        'municipal'::text,
        'private'::text,
        'military'::text,
        'unknown'::text
      ]
    )
  );

-- 3) Append-only verification event history for agents and admin workflows.
CREATE TABLE IF NOT EXISTS public.golf_course_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  golf_course_id UUID NOT NULL REFERENCES public.golf_courses(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,
  method TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  previous_course_type TEXT,
  new_course_type TEXT,
  confidence TEXT,
  excluded_reason TEXT,
  evidence_summary TEXT,
  raw_inputs JSONB,
  raw_outputs JSONB,
  external_refs JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.golf_course_verification_events IS
  'Append-only history of golf course verification decisions, evidence, and agent outputs.';
COMMENT ON COLUMN public.golf_course_verification_events.actor IS
  'Verifier version, agent id, or admin actor responsible for the event.';
COMMENT ON COLUMN public.golf_course_verification_events.method IS
  'Verification method such as rule_based, llm_perplexity, manual_ui, bulk_migration, or provider_refresh.';
COMMENT ON COLUMN public.golf_course_verification_events.raw_inputs IS
  'Structured provider facts or prompt inputs used by the verifier.';
COMMENT ON COLUMN public.golf_course_verification_events.raw_outputs IS
  'Structured verifier output, provider response excerpt, or error detail.';

CREATE INDEX IF NOT EXISTS idx_golf_course_verification_events_course_time
  ON public.golf_course_verification_events (golf_course_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_golf_course_verification_events_method_time
  ON public.golf_course_verification_events (method, occurred_at DESC);

ALTER TABLE public.golf_course_verification_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read golf course verification events"
  ON public.golf_course_verification_events;
DROP POLICY IF EXISTS "Admins manage golf course verification events"
  ON public.golf_course_verification_events;

CREATE POLICY "Admins read golf course verification events"
  ON public.golf_course_verification_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage golf course verification events"
  ON public.golf_course_verification_events
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
