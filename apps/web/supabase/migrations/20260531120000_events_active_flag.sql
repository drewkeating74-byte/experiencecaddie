-- Adds a soft-delete / deactivation flag to events.
-- Default true so all existing rows remain visible.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_events_active ON public.events (active);

COMMENT ON COLUMN public.events.active IS
  'false = deactivated (e.g. duplicate ingestion). Excluded from all public queries.';
