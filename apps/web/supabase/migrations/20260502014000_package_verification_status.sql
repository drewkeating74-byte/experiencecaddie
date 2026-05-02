-- Package verification lifecycle fields.
--
-- `active` remains the public publish flag. These columns explain whether the
-- package is verified, needs review, or was hidden by the verifier.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'needs_review', 'failed_twice', 'expired')),
  ADD COLUMN IF NOT EXISTS verification_fail_count INTEGER NOT NULL DEFAULT 0
    CHECK (verification_fail_count >= 0),
  ADD COLUMN IF NOT EXISTS last_verification_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verification_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_verification_source TEXT
    CHECK (last_verification_source IS NULL OR last_verification_source IN ('ticketmaster', 'perplexity', 'manual', 'system')),
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS verification_evidence_url TEXT;

COMMENT ON COLUMN public.packages.verification_status IS
  'Concert verification status used by verify-packages: unverified, verified, needs_review, failed_twice, expired.';
COMMENT ON COLUMN public.packages.verification_fail_count IS
  'Count of failed verification checks on separate calendar days. Two failures hide the package.';
COMMENT ON COLUMN public.packages.last_verification_failed_at IS
  'Most recent calendar day/time that automated verification failed.';
COMMENT ON COLUMN public.packages.last_verification_source IS
  'Provider or actor that produced the latest verification result.';
COMMENT ON COLUMN public.packages.verification_notes IS
  'Operator-facing explanation of the latest verification result.';
COMMENT ON COLUMN public.packages.verification_evidence_url IS
  'Provider URL or search URL supporting the latest verification result when available.';

CREATE INDEX IF NOT EXISTS packages_verification_status_idx
  ON public.packages (verification_status);

CREATE INDEX IF NOT EXISTS packages_verification_failed_at_idx
  ON public.packages (last_verification_failed_at);
