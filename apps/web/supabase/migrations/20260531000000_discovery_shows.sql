-- Discovery shows cache: upcoming weekend concerts across catalog metros,
-- refreshed on a schedule from Ticketmaster. The itinerary builder serves
-- genre / "best upcoming shows" discovery FROM this table instead of calling
-- Ticketmaster live on every request. This avoids TM's rate/quota limits
-- (5 req/sec burst-1 + daily quota) and makes "Show different options" a deep,
-- date-spread, instant rotation rather than a ~640-call-per-load live fan-out.
CREATE TABLE IF NOT EXISTS public.discovery_shows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tm_event_id  text NOT NULL UNIQUE,
  artist       text NOT NULL,
  event_name   text,
  metro_slug   text NOT NULL,
  city         text NOT NULL,
  venue        text,
  event_date   date NOT NULL,
  genre        text,
  ticket_url   text,
  image_url    text,
  min_price    numeric,
  max_price    numeric,
  score        integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_discovery_shows_date   ON public.discovery_shows (event_date);
CREATE INDEX IF NOT EXISTS idx_discovery_shows_metro  ON public.discovery_shows (metro_slug);
CREATE INDEX IF NOT EXISTS idx_discovery_shows_active ON public.discovery_shows (active);
CREATE INDEX IF NOT EXISTS idx_discovery_shows_score  ON public.discovery_shows (score DESC);

-- RLS: enable with no public policies. All reads/writes happen server-side in
-- edge functions using the service-role key (which bypasses RLS); anon clients
-- get no direct access. (New-table security default — no existing policies are
-- changed.)
ALTER TABLE public.discovery_shows ENABLE ROW LEVEL SECURITY;
