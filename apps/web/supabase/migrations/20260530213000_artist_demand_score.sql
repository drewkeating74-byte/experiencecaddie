-- Ticketmaster-derived demand score for artists. Used by the Packages page
-- "top artists / high-demand" ranking (Spotify popularity is unavailable to our
-- API app, so demand is proxied from Ticketmaster: tour-date breadth, venue
-- size tier, and ticket price). 0-100. Nullable + additive — no effect on the
-- package lifecycle or existing rows.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS ticketmaster_demand_score integer NULL,
  ADD COLUMN IF NOT EXISTS demand_synced_at timestamptz NULL;
