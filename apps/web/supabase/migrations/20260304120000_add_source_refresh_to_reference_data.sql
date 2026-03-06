-- Schema updates for persisting venues, golf courses, and hotels from API sources
-- Supports monthly refresh cadence and upsert by source + source_id

-- ---------------------------------------------------------------------------
-- 1. Venues: add source tracking and refresh timestamp
-- ---------------------------------------------------------------------------
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.venues.source IS 'Provider: ticketmaster, etc.';
COMMENT ON COLUMN public.venues.source_id IS 'External ID from provider for upserts';
COMMENT ON COLUMN public.venues.last_refreshed_at IS 'When this record was last synced from the source';

-- Unique constraint for upsert: one venue per (source, source_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_venues_source_id
  ON public.venues (source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;

-- Index for filtering by city (common search)
CREATE INDEX IF NOT EXISTS idx_venues_city_state
  ON public.venues (city, state)
  WHERE city IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Golf courses: add source tracking and refresh timestamp
-- ---------------------------------------------------------------------------
ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.golf_courses.source IS 'Provider: google_places, golfnow, etc.';
COMMENT ON COLUMN public.golf_courses.source_id IS 'External ID from provider (Place ID, facility ID) for upserts';
COMMENT ON COLUMN public.golf_courses.last_refreshed_at IS 'When this record was last synced from the source';

-- Unique constraint for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_golf_courses_source_id
  ON public.golf_courses (source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;

-- Index for geo and city search
CREATE INDEX IF NOT EXISTS idx_golf_courses_city_state
  ON public.golf_courses (city, state)
  WHERE city IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Hotels: new table (reference data for package building)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hotels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT,
  city TEXT NOT NULL,
  state TEXT,
  country TEXT DEFAULT 'United States',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  stars INTEGER,
  rating NUMERIC,
  image_url TEXT,
  booking_url TEXT,
  price_min NUMERIC,
  price_max NUMERIC,
  source TEXT,
  source_id TEXT,
  last_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hotels IS 'Reference data for hotels; refreshed monthly from Expedia, Booking.com, Hotels.com';
COMMENT ON COLUMN public.hotels.source IS 'Provider: expedia, booking, hotels_com';
COMMENT ON COLUMN public.hotels.source_id IS 'External ID from provider for upserts';
COMMENT ON COLUMN public.hotels.last_refreshed_at IS 'When this record was last synced from the source';

-- Unique constraint for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_hotels_source_id
  ON public.hotels (source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;

-- Index for city search
CREATE INDEX IF NOT EXISTS idx_hotels_city_state
  ON public.hotels (city, state)
  WHERE city IS NOT NULL;

-- RLS
ALTER TABLE public.hotels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read hotels"
  ON public.hotels FOR SELECT
  USING (true);

CREATE POLICY "Admin manage hotels"
  ON public.hotels FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Triggers
CREATE TRIGGER update_hotels_updated_at
  BEFORE UPDATE ON public.hotels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
