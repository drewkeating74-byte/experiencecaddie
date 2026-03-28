-- =============================================================================
-- Catalog: 20-Metro Expansion
-- Branch: catalog-20-cities
-- =============================================================================
-- What this does in plain English:
--   1. Creates a new metro_areas table to track the 20 supported cities,
--      their center map coordinates, and when each was last refreshed.
--   2. Adds missing columns to golf_courses so we can store review counts,
--      course type (public vs resort), par, and a direct tee-time booking URL.
--   3. Adds missing columns to venues so we can store venue type (arena vs
--      amphitheater), an image, a direct Ticketmaster link, and timezone.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. metro_areas
--    One row per supported metro. Tracks refresh cadence and center coords.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metro_areas (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- slug: machine-readable key used everywhere in code, e.g. "las-vegas"
  slug                    TEXT        NOT NULL UNIQUE,

  -- label: what users see, e.g. "Las Vegas, NV"
  label                   TEXT        NOT NULL,

  -- state: primary state abbreviation, e.g. "NV"
  state                   TEXT        NOT NULL,

  -- region: broad US region for grouping / filtering, e.g. "West"
  region                  TEXT,

  -- cities: every city name that belongs to this metro area.
  --   Used to match incoming search requests (e.g. "Scottsdale" → Phoenix metro).
  cities                  TEXT[]      NOT NULL DEFAULT '{}',

  -- center_lat / center_lng: the geographic center of the metro.
  --   Used as the origin for all radius searches when building itineraries.
  center_lat              DOUBLE PRECISION NOT NULL,
  center_lng              DOUBLE PRECISION NOT NULL,

  -- search_radius_miles: how far from the center we look for golf/venues.
  --   Default 30 miles; spread-out metros like DFW may use 40.
  search_radius_miles     INTEGER     NOT NULL DEFAULT 30,

  -- catalog_enabled: flip to true once we have real data for this metro.
  --   The itinerary builder checks this before preferring the catalog.
  catalog_enabled         BOOLEAN     NOT NULL DEFAULT false,

  -- last_golf_refresh_at / last_venue_refresh_at: timestamps so the
  --   refresh job knows whether data is stale (target: refresh every 30 days).
  last_golf_refresh_at    TIMESTAMPTZ,
  last_venue_refresh_at   TIMESTAMPTZ,

  -- golf_count / venue_count: cached row counts — handy for the admin dashboard.
  golf_count              INTEGER     DEFAULT 0,
  venue_count             INTEGER     DEFAULT 0,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.metro_areas IS 'The 20 supported metros for the internal Experience Caddie catalog. Controls which cities get catalog-first itinerary building vs live-API fallback.';
COMMENT ON COLUMN public.metro_areas.slug IS 'Snake-case key used in code, e.g. las-vegas';
COMMENT ON COLUMN public.metro_areas.cities IS 'All city names in this metro; used to route incoming searches to the right metro';
COMMENT ON COLUMN public.metro_areas.catalog_enabled IS 'Set true once real golf/venue data is loaded. Itinerary builder checks this flag.';
COMMENT ON COLUMN public.metro_areas.search_radius_miles IS 'Radius for golf/venue discovery around the metro center';

-- RLS for metro_areas: anyone can read, only admins can write
ALTER TABLE public.metro_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read metro_areas"
  ON public.metro_areas FOR SELECT USING (true);

CREATE POLICY "Admin manage metro_areas"
  ON public.metro_areas FOR ALL TO authenticated
  USING  (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Updated_at trigger
CREATE TRIGGER update_metro_areas_updated_at
  BEFORE UPDATE ON public.metro_areas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_metro_areas_slug
  ON public.metro_areas (slug);

CREATE INDEX IF NOT EXISTS idx_metro_areas_enabled
  ON public.metro_areas (catalog_enabled)
  WHERE catalog_enabled = true;


-- -----------------------------------------------------------------------------
-- 2. golf_courses — additional catalog columns
--    The base table + Phase 1A + source-refresh columns already exist.
--    We add the remaining fields needed for a rich, trusted catalog.
-- -----------------------------------------------------------------------------
ALTER TABLE public.golf_courses
  -- user_rating_count: number of Google reviews. Combined with rating to compute
  --   quality score. A course with 4.3 stars and 500 reviews is more trustworthy
  --   than one with 4.5 stars and 8 reviews.
  ADD COLUMN IF NOT EXISTS user_rating_count    INTEGER,

  -- course_type: more precise than the existing public_access BOOLEAN.
  --   'public'       → walk-up tee times, no membership needed
  --   'semi_private' → open to public but has member priority
  --   'resort'       → attached to a hotel/resort, premium pricing
  --   'municipal'    → city-owned, lowest green fees
  ADD COLUMN IF NOT EXISTS course_type          TEXT
    CHECK (course_type IS NULL OR course_type IN
      ('public', 'semi_private', 'resort', 'municipal', 'unknown')),

  -- par: standard par for 18 holes (typically 70–72).
  --   Shown to users as a basic course stat.
  ADD COLUMN IF NOT EXISTS par                  INTEGER,

  -- website_url: the club's official website (separate from booking_url which
  --   may be a GolfNow/TeeOff aggregator page).
  ADD COLUMN IF NOT EXISTS website_url          TEXT,

  -- tee_time_url: direct booking link on GolfNow, TeeOff, or the club site.
  --   Used as the primary CTA when a user clicks a golf option.
  ADD COLUMN IF NOT EXISTS tee_time_url         TEXT,

  -- distance_from_center_miles: cached straight-line distance from the metro
  --   center. Pre-computed at refresh time so itinerary queries are fast.
  ADD COLUMN IF NOT EXISTS distance_from_center_miles  NUMERIC,

  -- phone: club phone number, shown in the itinerary details panel.
  ADD COLUMN IF NOT EXISTS phone                TEXT;

-- Index for fast quality-sorted catalog queries
CREATE INDEX IF NOT EXISTS idx_golf_courses_metro_quality
  ON public.golf_courses (metro, normalized_quality_score DESC)
  WHERE active = true AND metro IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. venues — additional catalog columns
--    Source tracking was added in a prior migration. We add the catalog fields.
-- -----------------------------------------------------------------------------
ALTER TABLE public.venues
  -- image_url: hero photo of the venue, shown in itinerary cards.
  ADD COLUMN IF NOT EXISTS image_url            TEXT,

  -- website_url: official venue website.
  ADD COLUMN IF NOT EXISTS website_url          TEXT,

  -- venue_type: how we describe the space to users.
  --   'arena'           → indoor, 5k–20k capacity (e.g. Kaseya Center)
  --   'amphitheater'    → outdoor covered stage (e.g. Dos Equis Pavilion)
  --   'stadium'         → large outdoor (e.g. AT&T Stadium)
  --   'club'            → small indoor, <2k (e.g. Brooklyn Bowl)
  --   'theater'         → seated indoor show (e.g. Ryman Auditorium)
  --   'outdoor'         → open field / festival grounds
  ADD COLUMN IF NOT EXISTS venue_type           TEXT
    CHECK (venue_type IS NULL OR venue_type IN
      ('arena', 'amphitheater', 'stadium', 'club', 'theater', 'outdoor',
       'festival_grounds', 'other')),

  -- ticketmaster_market: Ticketmaster's internal market label for this city
  --   (e.g. "Las Vegas"). Used by the refresh job to scope TM API searches.
  ADD COLUMN IF NOT EXISTS ticketmaster_market  TEXT,

  -- ticketmaster_url: direct link to this venue's page on Ticketmaster.
  ADD COLUMN IF NOT EXISTS ticketmaster_url     TEXT,

  -- timezone: IANA timezone string for the venue, e.g. "America/Chicago".
  --   Used to display event times correctly to users in other timezones.
  ADD COLUMN IF NOT EXISTS timezone             TEXT,

  -- active: soft-delete flag. Set false if a venue closes or is irrelevant.
  ADD COLUMN IF NOT EXISTS active               BOOLEAN NOT NULL DEFAULT true,

  -- metro: which metro this venue belongs to (matches metro_areas.slug).
  --   Lets the itinerary builder filter venues by metro quickly.
  ADD COLUMN IF NOT EXISTS metro                TEXT,

  -- normalized_quality_score: same 0–100 scale used for golf courses.
  --   Computed from capacity, review count, Ticketmaster event frequency.
  ADD COLUMN IF NOT EXISTS normalized_quality_score  INTEGER;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_venues_metro_active
  ON public.venues (metro, active)
  WHERE active = true AND metro IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_venues_active
  ON public.venues (active)
  WHERE active = true;


-- -----------------------------------------------------------------------------
-- 4. Seed metro_areas with the 20 supported metros
--    catalog_enabled starts as false everywhere — we flip it to true
--    city-by-city after the refresh job has loaded real data.
-- -----------------------------------------------------------------------------
INSERT INTO public.metro_areas
  (slug, label, state, region, cities, center_lat, center_lng, search_radius_miles)
VALUES
  ('las-vegas',       'Las Vegas, NV',               'NV', 'West',
   ARRAY['Las Vegas','Henderson','North Las Vegas','Summerlin','Paradise'],
   36.1699, -115.1398, 30),

  ('phoenix',         'Phoenix / Scottsdale, AZ',    'AZ', 'West',
   ARRAY['Phoenix','Scottsdale','Tempe','Mesa','Gilbert','Chandler','Peoria','Glendale'],
   33.4942, -111.9261, 35),

  ('dallas',          'Dallas–Fort Worth, TX',        'TX', 'South',
   ARRAY['Dallas','Fort Worth','Irving','Arlington','Plano','Frisco','McKinney','Allen'],
   32.8481, -97.0641, 40),

  ('austin',          'Austin, TX',                   'TX', 'South',
   ARRAY['Austin','Round Rock','Cedar Park','Georgetown','Pflugerville','Kyle','Buda'],
   30.2672, -97.7431, 30),

  ('nashville',       'Nashville, TN',                'TN', 'South',
   ARRAY['Nashville','Brentwood','Franklin','Murfreesboro','Hendersonville','Smyrna'],
   36.1627, -86.7816, 30),

  ('atlanta',         'Atlanta, GA',                  'GA', 'South',
   ARRAY['Atlanta','Alpharetta','Marietta','Sandy Springs','Roswell','Dunwoody','Peachtree City'],
   33.7490, -84.3880, 35),

  ('charlotte',       'Charlotte, NC',                'NC', 'South',
   ARRAY['Charlotte','Concord','Gastonia','Rock Hill','Huntersville','Matthews','Kannapolis'],
   35.2271, -80.8431, 30),

  ('tampa',           'Tampa / St. Petersburg, FL',   'FL', 'South',
   ARRAY['Tampa','St. Petersburg','Clearwater','Brandon','Lakeland','Sarasota'],
   27.9506, -82.4572, 35),

  ('miami',           'Miami / Fort Lauderdale, FL',  'FL', 'South',
   ARRAY['Miami','Fort Lauderdale','Boca Raton','West Palm Beach','Coral Gables','Doral','Hollywood'],
   26.0112, -80.1494, 40),

  ('san-diego',       'San Diego, CA',                'CA', 'West',
   ARRAY['San Diego','Chula Vista','La Jolla','Escondido','Oceanside','Carlsbad','El Cajon'],
   32.7157, -117.1611, 30),

  ('los-angeles',     'Los Angeles, CA',              'CA', 'West',
   ARRAY['Los Angeles','Pasadena','Long Beach','Burbank','Glendale','Torrance','Santa Monica','Anaheim'],
   34.0195, -118.4912, 40),

  ('san-francisco',   'San Francisco Bay Area, CA',   'CA', 'West',
   ARRAY['San Francisco','Oakland','San Jose','Berkeley','Fremont','Santa Clara','Palo Alto','San Mateo'],
   37.4419, -122.1430, 40),

  ('denver',          'Denver, CO',                   'CO', 'West',
   ARRAY['Denver','Aurora','Lakewood','Arvada','Westminster','Thornton','Centennial','Englewood'],
   39.7392, -104.9903, 35),

  ('seattle',         'Seattle, WA',                  'WA', 'West',
   ARRAY['Seattle','Bellevue','Tacoma','Redmond','Kirkland','Renton','Bothell','Issaquah'],
   47.6062, -122.3321, 35),

  ('chicago',         'Chicago, IL',                  'IL', 'Midwest',
   ARRAY['Chicago','Naperville','Evanston','Oak Park','Schaumburg','Aurora','Joliet'],
   41.8781, -87.6298, 40),

  ('new-orleans',     'New Orleans, LA',              'LA', 'South',
   ARRAY['New Orleans','Metairie','Kenner','Slidell','Covington','Mandeville','Gretna'],
   29.9511, -90.0715, 30),

  ('boston',          'Boston, MA',                   'MA', 'Northeast',
   ARRAY['Boston','Cambridge','Somerville','Newton','Quincy','Brookline','Worcester'],
   42.3601, -71.0589, 35),

  ('philadelphia',    'Philadelphia, PA',             'PA', 'Northeast',
   ARRAY['Philadelphia','Camden','Wilmington','Cherry Hill','King of Prussia','Conshohocken'],
   39.9526, -75.1652, 35),

  ('detroit',         'Detroit, MI',                  'MI', 'Midwest',
   ARRAY['Detroit','Ann Arbor','Dearborn','Warren','Sterling Heights','Pontiac','Troy','Livonia'],
   42.3314, -83.0458, 35),

  ('cleveland',       'Cleveland, OH',                'OH', 'Midwest',
   ARRAY['Cleveland','Akron','Parma','Lakewood','Strongsville','Mentor','Euclid'],
   41.4993, -81.6944, 30)

ON CONFLICT (slug) DO NOTHING;
