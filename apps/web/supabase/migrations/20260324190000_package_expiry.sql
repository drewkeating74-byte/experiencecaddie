-- Add package lifecycle and hotel booking columns
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS expires_at     timestamptz,
  ADD COLUMN IF NOT EXISTS hotel_name     text,
  ADD COLUMN IF NOT EXISTS hotel_url      text;

-- Backfill expires_at = event_date + 2 days (covers the show weekend)
-- for active packages that already exist
UPDATE public.packages p
SET expires_at = (
  SELECT (e.event_date + interval '2 days')::timestamptz
  FROM public.events e
  WHERE e.id = p.event_id
)
WHERE p.expires_at IS NULL
  AND p.event_id IS NOT NULL;

-- Packages with no linked event default to 60 days from now
UPDATE public.packages
SET expires_at = now() + interval '60 days'
WHERE expires_at IS NULL;

-- Index for fast "show only unexpired" filtering
CREATE INDEX IF NOT EXISTS packages_expires_at_idx
  ON public.packages (expires_at);
