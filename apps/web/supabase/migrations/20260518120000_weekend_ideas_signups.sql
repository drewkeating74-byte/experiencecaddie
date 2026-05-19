-- weekend_ideas_signups: lightweight marketing list (no auth required).
-- Inserts via subscribe-weekend-ideas Edge Function (service role only).

CREATE TABLE IF NOT EXISTS public.weekend_ideas_signups (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email              text        NOT NULL,
  favorite_city      text,
  favorite_interests text,
  requested_city     text,
  source             text        NOT NULL CHECK (
    source IN ('homepage', 'itinerary_results', 'unsupported_city', 'no_results')
  ),
  itinerary_id       uuid        REFERENCES public.itineraries (id) ON DELETE SET NULL,
  user_id            uuid        REFERENCES auth.users (id) ON DELETE SET NULL,
  consent_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekend_ideas_signups_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS weekend_ideas_signups_source_idx
  ON public.weekend_ideas_signups (source);

CREATE INDEX IF NOT EXISTS weekend_ideas_signups_created_at_idx
  ON public.weekend_ideas_signups (created_at DESC);

CREATE INDEX IF NOT EXISTS weekend_ideas_signups_requested_city_idx
  ON public.weekend_ideas_signups (requested_city)
  WHERE requested_city IS NOT NULL;

ALTER TABLE public.weekend_ideas_signups ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.weekend_ideas_signups_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS weekend_ideas_signups_updated_at ON public.weekend_ideas_signups;
CREATE TRIGGER weekend_ideas_signups_updated_at
  BEFORE UPDATE ON public.weekend_ideas_signups
  FOR EACH ROW
  EXECUTE FUNCTION public.weekend_ideas_signups_set_updated_at();
