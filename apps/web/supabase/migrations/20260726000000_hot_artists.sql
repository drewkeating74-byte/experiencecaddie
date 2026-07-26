-- Weekly "What's Hot" artist cache: culturally hot artists from music media
-- (Perplexity scan of Rolling Stone / Spin / Billboard / Pitchfork / NPR / RA).
-- Genre / surprise discovery reads this table to seed and re-rank Ticketmaster
-- inventory checks — tour proof stays on discovery_shows + live TM.

CREATE TABLE IF NOT EXISTS public.hot_artists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_key    text NOT NULL UNIQUE,
  artist_name   text NOT NULL,
  genres        text[] NOT NULL DEFAULT '{}',
  sources       text[] NOT NULL DEFAULT '{}',
  signal_types  text[] NOT NULL DEFAULT '{}',
  source_count  integer NOT NULL DEFAULT 1,
  heat_score    numeric NOT NULL DEFAULT 0,
  evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  refreshed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hot_artists_active_heat
  ON public.hot_artists (active, heat_score DESC);
CREATE INDEX IF NOT EXISTS idx_hot_artists_genres
  ON public.hot_artists USING gin (genres);

COMMENT ON TABLE public.hot_artists IS
  'Weekly culturally-hot artist cache from music media. Seeds genre/surprise discovery; Ticketmaster proves nearby tour dates.';

-- RLS: enable with no public policies. All reads/writes happen server-side in
-- edge functions using the service-role key (which bypasses RLS); anon clients
-- get no direct access.
ALTER TABLE public.hot_artists ENABLE ROW LEVEL SECURITY;
