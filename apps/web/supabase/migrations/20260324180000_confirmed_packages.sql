-- ============================================================
-- Real confirmed-date packages built from live Ticketmaster events.
-- Every ticket_url is a direct event page URL verified against
-- the Ticketmaster Discovery API on 2026-03-24.
-- ============================================================

-- ---- Artists -----------------------------------------------
INSERT INTO public.artists (id, name, genre, subgenre, description) VALUES
  ('a2ec0001-0000-0000-0000-000000000001', 'George Strait',    'Country',   'Traditional Country',
   'The King of Country — 60 #1 hits and one of the best-selling music artists of all time.'),
  ('a2ec0001-0000-0000-0000-000000000002', 'Kid Cudi',         'Hip-Hop',   'Alternative Hip-Hop',
   'Multi-platinum rapper and producer known for genre-defying stadium energy.'),
  ('a2ec0001-0000-0000-0000-000000000003', 'Grand Ole Opry',   'Country',   'Country/Various',
   'The show that made country music famous — Nashville''s most iconic live performance institution since 1925.'),
  ('a2ec0001-0000-0000-0000-000000000004', 'Kid Rock',         'Rock',      'Rock/Country',
   'High-energy arena rock with country and hip-hop swagger — always a massive live show.'),
  ('a2ec0001-0000-0000-0000-000000000005', 'Bruce Springsteen','Rock',      'Classic Rock',
   'The Boss and the E Street Band — legendary three-hour shows that have set the standard for rock live performance.'),
  ('a2ec0001-0000-0000-0000-000000000006', 'Jason Isbell',     'Americana', 'Alt-Country',
   'Grammy-winning songwriter with one of the most loyal followings in Americana — raw, honest, and unforgettable live.')
ON CONFLICT (id) DO NOTHING;

-- ---- Venues ------------------------------------------------
INSERT INTO public.venues (id, name, city, state, country, lat, lng, capacity, venue_type, active, metro) VALUES
  ('b2ec0001-0000-0000-0000-000000000001', 'Grand Ole Opry House',    'Nashville', 'TN', 'US',
    36.18868, -86.71883, 4372,  'theater', true, 'nashville'),
  ('b2ec0001-0000-0000-0000-000000000002', 'Mortgage Matchup Center', 'Phoenix',   'AZ', 'US',
    33.44574, -112.07121, 18422, 'arena',   true, 'phoenix'),
  ('b2ec0001-0000-0000-0000-000000000003', 'Mission Ballroom',        'Denver',    'CO', 'US',
    39.76467, -104.98062, 3950,  'theater', true, 'denver')
ON CONFLICT (id) DO NOTHING;

-- ---- Events (all ticket_urls are confirmed direct event pages) -
INSERT INTO public.events (id, name, artist_id, venue_id, event_date, event_time, timezone, ticket_url, min_price, max_price) VALUES

  -- George Strait | Moody Center ATX, Austin TX | Sat April 11 2026
  ('e2ec0001-0000-0000-0000-000000000001',
   'George Strait',
   'a2ec0001-0000-0000-0000-000000000001',
   '9de8314c-399f-4b12-a442-50d8f84c6e78',
   '2026-04-11', '19:30:00', 'America/Chicago',
   'https://www.ticketmaster.com/george-strait-austin-texas-04-11-2026/event/3A00643408644A8D',
   85, 350),

  -- Kid Cudi | Germania Insurance Amphitheater, Austin TX | Fri May 1 2026
  ('e2ec0001-0000-0000-0000-000000000002',
   'Kid Cudi: The Rebel Ragers Tour 2026',
   'a2ec0001-0000-0000-0000-000000000002',
   '4d428105-7dd7-4dd5-bab1-75c937f2bb83',
   '2026-05-01', '20:00:00', 'America/Chicago',
   'https://www.ticketmaster.com/kid-cudi-presents-the-rebel-ragers-austin-texas-05-01-2026/event/3A00642F81CE7703',
   55, 185),

  -- Grand Ole Opry OPRY 100 | Grand Ole Opry House, Nashville TN | Fri May 1 2026
  ('e2ec0001-0000-0000-0000-000000000003',
   'Grand Ole Opry: OPRY 100',
   'a2ec0001-0000-0000-0000-000000000003',
   'b2ec0001-0000-0000-0000-000000000001',
   '2026-05-01', '19:00:00', 'America/Chicago',
   'https://www.ticketmaster.com/event/Z7r9jZ1A7qxk3',
   55, 120),

  -- Kid Rock | Dos Equis Pavilion, Dallas TX | Fri May 1 2026
  ('e2ec0001-0000-0000-0000-000000000004',
   'Kid Rock: Freedom 250 Tour',
   'a2ec0001-0000-0000-0000-000000000004',
   '9082ac82-82d5-4bce-b6d9-948beaeb1e22',
   '2026-05-01', '19:30:00', 'America/Chicago',
   'https://www.ticketmaster.com/kid-rock-freedom-250-tour-dallas-texas-05-01-2026/event/0C006445CA6BB394',
   45, 175),

  -- Springsteen & E Street | Mortgage Matchup Center, Phoenix AZ | Thu April 16 2026
  ('e2ec0001-0000-0000-0000-000000000005',
   'Springsteen & E Street: Land of Hope & Dreams American Tour',
   'a2ec0001-0000-0000-0000-000000000005',
   'b2ec0001-0000-0000-0000-000000000002',
   '2026-04-16', '19:30:00', 'America/Phoenix',
   'https://www.ticketmaster.com/springsteen-e-street-land-of-hope-phoenix-arizona-04-16-2026/event/1900644FBB645FF0',
   75, 400),

  -- Jason Isbell & the 400 Unit | Mission Ballroom, Denver CO | Fri May 1 2026
  ('e2ec0001-0000-0000-0000-000000000006',
   'Jason Isbell & the 400 Unit',
   'a2ec0001-0000-0000-0000-000000000006',
   'b2ec0001-0000-0000-0000-000000000003',
   '2026-05-01', '20:00:00', 'America/Denver',
   'https://www.ticketmaster.com/event/Z7r9jZ1A7qYP8',
   45, 125)

ON CONFLICT (id) DO NOTHING;

-- ---- Packages ----------------------------------------------
INSERT INTO public.packages (
  id, name, event_id, golf_course_id, destination_id,
  description, price, original_price, category, featured, active, image_url
) VALUES

  -- 1. George Strait + Barton Creek Fazio Canyons | Austin, TX
  ('f2ec0001-0000-0000-0000-000000000001',
   'George Strait + Barton Creek | Austin, TX',
   'e2ec0001-0000-0000-0000-000000000001',
   '09db59e8-4142-43e7-b332-d0a32d0667c1',
   'd1ec0001-0000-0000-0000-000000000001',
   'Watch a Texas legend play to a packed Moody Center, then tee off the next morning on Barton Creek''s championship Fazio Canyons course. Hill Country views, cold beer, and 60 #1 hits.',
   850, 995, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1494961104209-3c223057bd26?w=800&h=500&fit=crop'),

  -- 2. Kid Cudi + Lions Municipal | Austin, TX
  ('f2ec0001-0000-0000-0000-000000000002',
   'Kid Cudi + Lions Municipal | Austin, TX',
   'e2ec0001-0000-0000-0000-000000000002',
   '406cc151-670d-4d97-aaff-2945ac18d835',
   'd1ec0001-0000-0000-0000-000000000001',
   'Kid Cudi''s Rebel Ragers Tour at the open-air Germania Amphitheater, then 18 holes at Lions Municipal — Austin''s legendary public muni with fairways that have hosted players for nearly a century.',
   650, 795, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&h=500&fit=crop'),

  -- 3. Grand Ole Opry OPRY 100 + Golf Club of Tennessee | Nashville, TN
  ('f2ec0001-0000-0000-0000-000000000003',
   'Grand Ole Opry 100th + Golf Club of Tennessee | Nashville, TN',
   'e2ec0001-0000-0000-0000-000000000003',
   '94a87b6b-d312-406a-92c4-50319193f801',
   'd1ec0001-0000-0000-0000-000000000002',
   'Celebrate 100 years of the Grand Ole Opry at the most storied stage in country music, then play one of Nashville''s top public layouts the next morning. Music history plus fairway history.',
   750, 895, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1520342868574-5fa3804e551c?w=800&h=500&fit=crop'),

  -- 4. Kid Rock + Cowboys Golf Club | Dallas, TX
  ('f2ec0001-0000-0000-0000-000000000004',
   'Kid Rock + Cowboys Golf Club | Dallas, TX',
   'e2ec0001-0000-0000-0000-000000000004',
   '2433b35d-d732-4b38-8fa7-d5330b03a9dc',
   'd1ec0001-0000-0000-0000-000000000005',
   'Kid Rock at the outdoor Dos Equis Pavilion, then 18 holes at Cowboys Golf Club — with views of AT&T Stadium from the fairways. A Texas-sized Friday night and Saturday morning.',
   700, 850, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&h=500&fit=crop'),

  -- 5. Springsteen & E Street + Ocotillo Golf Club | Phoenix, AZ
  ('f2ec0001-0000-0000-0000-000000000005',
   'Springsteen & E Street + Ocotillo Golf Club | Phoenix, AZ',
   'e2ec0001-0000-0000-0000-000000000005',
   '8174aaad-acb2-439a-ae70-9b93af40feff',
   'd1ec0001-0000-0000-0000-000000000004',
   'The Boss and the E Street Band at 19,000-seat Mortgage Matchup Center — one of the last chances to see a living legend. Pair it with a round at Ocotillo Golf Club, known for its 9 lakes and lush desert design.',
   900, 1050, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1540541338537-1220059ec600?w=800&h=500&fit=crop'),

  -- 6. Jason Isbell + Fossil Trace Golf Club | Denver, CO
  ('f2ec0001-0000-0000-0000-000000000006',
   'Jason Isbell + Fossil Trace Golf Club | Denver, CO',
   'e2ec0001-0000-0000-0000-000000000006',
   'cbcaf5da-8bd8-4b2b-a7e3-ea3cc0329ee4',
   'd1ec0001-0000-0000-0000-000000000006',
   'A Friday night set from Jason Isbell & the 400 Unit at Mission Ballroom, followed by 18 holes at Fossil Trace — a Colorado gem carved through 65-million-year-old rock formations. Elevation, roots music, and views.',
   650, 795, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=800&h=500&fit=crop')

ON CONFLICT (id) DO NOTHING;
