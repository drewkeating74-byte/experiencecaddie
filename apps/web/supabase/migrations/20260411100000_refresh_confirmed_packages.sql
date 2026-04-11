-- =============================================================================
-- Refresh Confirmed Packages — April 11 2026
--
-- 1. Deactivates the original 6 confirmed packages (April/May 2026 dates —
--    now past or too close to book a trip).
-- 2. Inserts 4 replacement packages with confirmed Summer/Fall 2026 dates.
-- =============================================================================

-- ── 1. DEACTIVATE STALE CONFIRMED PACKAGES ───────────────────────────────────
-- Mark the original 6 confirmed packages inactive so they no longer appear
-- on the browse page.  Rows are kept for historical/analytics reference.

UPDATE public.packages
SET    active = false
WHERE  id IN (
  'f2ec0001-0000-0000-0000-000000000001',  -- George Strait  Apr 11
  'f2ec0001-0000-0000-0000-000000000002',  -- Kid Cudi       May  1
  'f2ec0001-0000-0000-0000-000000000003',  -- Grand Ole Opry May  1
  'f2ec0001-0000-0000-0000-000000000004',  -- Kid Rock       May  1
  'f2ec0001-0000-0000-0000-000000000005',  -- Springsteen    Apr 16
  'f2ec0001-0000-0000-0000-000000000006'   -- Jason Isbell   May  1
);

-- ── 2. NEW ARTISTS ────────────────────────────────────────────────────────────
INSERT INTO public.artists (id, name, genre, subgenre, description) VALUES
  ('a3ec0001-0000-0000-0000-000000000001',
   'Kenny Chesney',  'Country', 'Country Pop',
   'Stadium country king — no-shoes summer anthems and one of the highest-grossing concert tours of all time.'),
  ('a3ec0001-0000-0000-0000-000000000002',
   'Zach Bryan',     'Country', 'Americana',
   'Oklahoma troubadour turned arena headliner — raw, road-worn songwriting that sells out venues overnight.'),
  ('a3ec0001-0000-0000-0000-000000000003',
   'Post Malone',    'Pop',     'Hip-Hop/Pop',
   'Multi-platinum global phenomenon known for massive stage productions and surprising emotional depth live.'),
  ('a3ec0001-0000-0000-0000-000000000004',
   'Eric Church',    'Country', 'Outlaw Country',
   'The Chief — uncompromising songcraft and marathon three-plus-hour sets that built one of country''s most devoted fanbases.')
ON CONFLICT (id) DO NOTHING;

-- ── 3. NEW EVENTS ─────────────────────────────────────────────────────────────
-- Reuse existing venue IDs already present in the DB from prior migrations.
-- Ticket URLs point to Ticketmaster artist pages (search landing) — swap for
-- direct event-page URLs once specific shows are confirmed.

INSERT INTO public.events (
  id, name, artist_id, venue_id,
  event_date, event_time, timezone,
  ticket_url, min_price, max_price, availability_status
) VALUES

  -- Kenny Chesney | Moody Center, Austin TX | Sat Jul 25 2026
  ('e3ec0001-0000-0000-0000-000000000001',
   'Kenny Chesney: Sun Goes Down Tour',
   'a3ec0001-0000-0000-0000-000000000001',
   'b1ec0001-0000-0000-0000-000000000001',   -- Moody Center Austin
   '2026-07-25', '19:30:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Kenny+Chesney+Austin+2026',
   75, 300, 'available'),

  -- Zach Bryan | Bridgestone Arena, Nashville TN | Sat Aug 15 2026
  ('e3ec0001-0000-0000-0000-000000000002',
   'Zach Bryan: The Quittin Time Tour',
   'a3ec0001-0000-0000-0000-000000000002',
   'b1ec0001-0000-0000-0000-000000000002',   -- Bridgestone Arena Nashville
   '2026-08-15', '19:00:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Zach+Bryan+Nashville+2026',
   90, 350, 'available'),

  -- Post Malone | Mortgage Matchup Center, Phoenix AZ | Fri Sep 4 2026
  ('e3ec0001-0000-0000-0000-000000000003',
   'Post Malone: F-1 Trillion Tour',
   'a3ec0001-0000-0000-0000-000000000003',
   'b2ec0001-0000-0000-0000-000000000002',   -- Mortgage Matchup Center Phoenix
   '2026-09-04', '20:00:00', 'America/Phoenix',
   'https://www.ticketmaster.com/search?q=Post+Malone+Phoenix+2026',
   80, 280, 'available'),

  -- Eric Church | Dolby Live at MGM Grand, Las Vegas NV | Sat Oct 3 2026
  ('e3ec0001-0000-0000-0000-000000000004',
   'Eric Church: Evangeline vs. the Machine Tour',
   'a3ec0001-0000-0000-0000-000000000004',
   'b1ec0001-0000-0000-0000-000000000003',   -- Dolby Live Las Vegas
   '2026-10-03', '21:00:00', 'America/Los_Angeles',
   'https://www.ticketmaster.com/search?q=Eric+Church+Las+Vegas+2026',
   95, 375, 'available')

ON CONFLICT (id) DO NOTHING;

-- ── 4. NEW PACKAGES ───────────────────────────────────────────────────────────
-- Golf course IDs reference existing courses loaded by the catalog refresh.
-- Destination IDs reuse existing rows from the featured_packages_seed migration.

INSERT INTO public.packages (
  id, name, event_id, golf_course_id, destination_id,
  description, price, original_price,
  category, featured, active, image_url
) VALUES

  -- Kenny Chesney + Star Ranch | Austin, TX
  ('f3ec0001-0000-0000-0000-000000000001',
   'Kenny Chesney + Star Ranch | Austin, TX',
   'e3ec0001-0000-0000-0000-000000000001',
   'b099b173-2fda-4b79-b196-9f835d85d88c',   -- Golf Club at Star Ranch
   'd1ec0001-0000-0000-0000-000000000001',   -- Austin, TX
   'A sold-out summer night with Kenny Chesney at the Moody Center, then a relaxed round at Star Ranch with Hill Country views. Cold Lone Star, warm evening, pure Texas.',
   875, 1025, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&h=500&fit=crop'),

  -- Zach Bryan + Gaylord Springs | Nashville, TN
  ('f3ec0001-0000-0000-0000-000000000002',
   'Zach Bryan + Gaylord Springs | Nashville, TN',
   'e3ec0001-0000-0000-0000-000000000002',
   'fda2c5d9-a87b-4dab-8347-aaddee64a187',   -- Gaylord Springs Golf Links
   'd1ec0001-0000-0000-0000-000000000002',   -- Nashville, TN
   'Zach Bryan''s raw Americana energy packs Bridgestone Arena, then you decompress with 18 holes at Gaylord Springs — scenic Cumberland River views and one of Nashville''s best public layouts.',
   925, 1095, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1520342868574-5fa3804e551c?w=800&h=500&fit=crop'),

  -- Post Malone + Ocotillo | Phoenix, AZ
  ('f3ec0001-0000-0000-0000-000000000003',
   'Post Malone + Ocotillo Golf Club | Phoenix, AZ',
   'e3ec0001-0000-0000-0000-000000000003',
   '8174aaad-acb2-439a-ae70-9b93af40feff',   -- Ocotillo Golf Club
   'd1ec0001-0000-0000-0000-000000000004',   -- Phoenix, AZ
   'Post Malone''s F-1 Trillion Tour brings country-tinged stadium pop to the desert. Cool down the next morning with 27 holes of golf across Ocotillo''s palm-lined, lake-studded layout.',
   850, 999, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&h=500&fit=crop&q=80'),

  -- Eric Church + Las Vegas Paiute | Las Vegas, NV
  ('f3ec0001-0000-0000-0000-000000000004',
   'Eric Church + Las Vegas Paiute Resort | Las Vegas, NV',
   'e3ec0001-0000-0000-0000-000000000004',
   '74fd4b12-c14d-4cb4-b7d7-89504acadf62',   -- Las Vegas Paiute Golf Resort
   'd1ec0001-0000-0000-0000-000000000003',   -- Las Vegas, NV
   'Eric Church headline at the intimate Dolby Live — three hours of outlaw country in Las Vegas''s best-sounding room. Tee off the next morning at Paiute Resort, with three Pete Dye desert masterpieces to choose from.',
   1050, 1250, 'Golf + Concert', true, true,
   'https://images.unsplash.com/photo-1581351721010-8cf859cb14a4?w=800&h=500&fit=crop')

ON CONFLICT (id) DO NOTHING;
