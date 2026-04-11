-- =============================================================================
-- Two additional curated golf + concert packages (Dallas + Denver)
-- Ensures Dallas & Denver destination rows exist (referenced by older confirmed
-- packages but not in the original 3-city featured seed).
-- =============================================================================

INSERT INTO public.destinations (id, name, city, state, country, lat, lng, image_url, description)
VALUES
  ('d1ec0001-0000-0000-0000-000000000005',
   'Dallas, TX', 'Dallas', 'TX', 'US', 32.7767, -96.7970,
   'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&fit=crop',
   'Big D — stadium concerts, Texas barbecue, and championship public golf across DFW.'),
  ('d1ec0001-0000-0000-0000-000000000006',
   'Denver, CO', 'Denver', 'CO', 'US', 39.7392, -104.9903,
   'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=800&fit=crop',
   'Mile High City — live music, craft beer, and mountain-view golf at elevation.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.artists (id, name, genre, subgenre, description) VALUES
  ('a3ec0001-0000-0000-0000-000000000005',
   'Miranda Lambert', 'Country', 'Contemporary Country',
   'Grammy-winning Texas firebrand — arena-filling anthems and one of modern country''s most commanding live voices.'),
  ('a3ec0001-0000-0000-0000-000000000006',
   'Noah Kahan',      'Folk',    'Indie Folk',
   'Vermont-born singer-songwriter whose stadium-sized singalongs turned folk-pop into a global phenomenon.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (
  id, name, artist_id, venue_id,
  event_date, event_time, timezone,
  ticket_url, min_price, max_price, availability_status
) VALUES

  -- Miranda Lambert | Dos Equis Pavilion, Dallas TX | Sat Aug 22 2026
  ('e3ec0001-0000-0000-0000-000000000005',
   'Miranda Lambert',
   'a3ec0001-0000-0000-0000-000000000005',
   '9082ac82-82d5-4bce-b6d9-948beaeb1e22',   -- Dos Equis Pavilion Dallas
   '2026-08-22', '19:30:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Miranda+Lambert+Dallas+2026',
   65, 275, 'available'),

  -- Noah Kahan | Mission Ballroom, Denver CO | Fri Sep 18 2026
  ('e3ec0001-0000-0000-0000-000000000006',
   'Noah Kahan',
   'a3ec0001-0000-0000-0000-000000000006',
   'b2ec0001-0000-0000-0000-000000000003',   -- Mission Ballroom Denver
   '2026-09-18', '20:00:00', 'America/Denver',
   'https://www.ticketmaster.com/search?q=Noah+Kahan+Denver+2026',
   55, 185, 'available')

ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (
  id, name, event_id, golf_course_id, destination_id,
  description, price, original_price,
  category, featured, active, image_url
) VALUES

  ('f3ec0001-0000-0000-0000-000000000005',
   'Miranda Lambert + Cowboys Golf Club | Dallas, TX',
   'e3ec0001-0000-0000-0000-000000000005',
   '2433b35d-d732-4b38-8fa7-d5330b03a9dc',   -- Cowboys Golf Club
   'd1ec0001-0000-0000-0000-000000000005',   -- Dallas, TX
   'Miranda Lambert under the Texas sky at Dos Equis Pavilion, then 18 holes at Cowboys Golf Club — fairways with AT&T Stadium in view. Big hair, bigger hooks, pure DFW weekend energy.',
   895, 1045, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800&h=500&fit=crop'),

  ('f3ec0001-0000-0000-0000-000000000006',
   'Noah Kahan + Fossil Trace Golf Club | Denver, CO',
   'e3ec0001-0000-0000-0000-000000000006',
   'cbcaf5da-8bd8-4b2b-a7e3-ea3cc0329ee4',   -- Fossil Trace Golf Club
   'd1ec0001-0000-0000-0000-000000000006',   -- Denver, CO
   'Noah Kahan''s intimate arena anthems at Mission Ballroom, then morning golf at Fossil Trace — dinosaur footprints in the bunkers and Front Range air in your lungs.',
   775, 925, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1517649763962-0c623066013b?w=800&h=500&fit=crop')

ON CONFLICT (id) DO NOTHING;
