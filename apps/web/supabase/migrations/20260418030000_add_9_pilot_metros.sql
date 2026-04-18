-- Seed metro_areas for the 9 pilot-expansion metros added in Apr 2026.
--
-- These rows let refresh-catalog's updateMetroStats() function track last
-- refresh time and course/venue counts per metro. Without them, the UPDATE
-- in updateMetroStats is a silent no-op for new metros — catalog data still
-- lands in golf_courses just fine, but stats never populate.
--
-- Keep the INSERT values in sync with METROS in
-- supabase/functions/_shared/golfCities.ts. If those diverge, search /
-- itinerary routing will break for the divergent metro.

INSERT INTO public.metro_areas
  (slug, label, state, region, cities, center_lat, center_lng, search_radius_miles)
VALUES
  ('new-york-city',   'New York City, NY',                      'NY', 'Northeast',
   ARRAY['New York','Manhattan','Brooklyn','Queens','Bronx','Staten Island','Jersey City','Newark','Hoboken','Long Island','White Plains','Yonkers','Stamford'],
   40.7128, -74.0060, 40),

  ('palm-springs',    'Greater Palm Springs, CA',               'CA', 'West',
   ARRAY['Palm Springs','Palm Desert','Indian Wells','La Quinta','Rancho Mirage','Cathedral City','Indio','Desert Hot Springs'],
   33.8303, -116.5453, 30),

  ('orlando',         'Orlando, FL',                            'FL', 'South',
   ARRAY['Orlando','Kissimmee','Lake Buena Vista','Winter Park','Altamonte Springs','Sanford','Lake Mary','Celebration','Winter Garden','Dr. Phillips'],
   28.5383, -81.3792, 30),

  ('houston',         'Houston, TX',                            'TX', 'South',
   ARRAY['Houston','The Woodlands','Sugar Land','Katy','Pearland','Spring','Humble','Missouri City','Cypress','Kingwood'],
   29.7604, -95.3698, 35),

  ('san-antonio',     'San Antonio, TX',                        'TX', 'South',
   ARRAY['San Antonio','Helotes','Boerne','Schertz','Cibolo','Universal City','Alamo Heights','Leon Valley','New Braunfels'],
   29.4241, -98.4936, 30),

  ('milwaukee',       'Milwaukee, WI',                          'WI', 'Midwest',
   ARRAY['Milwaukee','Brookfield','Waukesha','Wauwatosa','West Allis','Mequon','Franklin','Greenfield','Oak Creek','Menomonee Falls'],
   43.0389, -87.9065, 30),

  ('portland',        'Portland, OR',                           'OR', 'West',
   ARRAY['Portland','Beaverton','Hillsboro','Gresham','Tigard','Lake Oswego','West Linn','Tualatin','Oregon City','Milwaukie'],
   45.5051, -122.6750, 30),

  ('washington-dc',   'Washington D.C. / Northern Virginia',    'VA', 'Northeast',
   ARRAY['Washington','Arlington','Alexandria','Bethesda','Rockville','Silver Spring','Fairfax','Reston','Tysons','McLean','Chevy Chase','Leesburg','Ashburn'],
   38.9072, -77.0369, 35),

  ('kansas-city',     'Kansas City, MO/KS',                     'MO', 'Midwest',
   ARRAY['Kansas City','Overland Park','Olathe','Lee''s Summit','Independence','Shawnee','Lenexa','Blue Springs','Leawood','Prairie Village'],
   39.0997, -94.5786, 30)

ON CONFLICT (slug) DO NOTHING;
