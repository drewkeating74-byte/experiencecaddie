-- =============================================================================
-- Featured Packages Seed — 9 showcase packages
-- 3 genres (country, rock, pop) × 3 catalog metros (Austin, Nashville, Las Vegas)
--
-- Golf courses reference real IDs from the refresh-catalog runs:
--   Austin:     b099b173-2fda-4b79-b196-9f835d85d88c  The Golf Club at Star Ranch
--   Nashville:  fda2c5d9-a87b-4dab-8347-aaddee64a187  Gaylord Springs Golf Links
--   Las Vegas:  74fd4b12-c14d-4cb4-b7d7-89504acadf62  Las Vegas Paiute Golf Resort
--
-- All INSERTs use ON CONFLICT (id) DO NOTHING so the migration is safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Destinations
-- -----------------------------------------------------------------------------
INSERT INTO public.destinations (id, name, city, state, country, lat, lng, image_url, description)
VALUES
  ('d1ec0001-0000-0000-0000-000000000001',
   'Austin, TX', 'Austin', 'TX', 'US', 30.2672, -97.7431,
   'https://images.unsplash.com/photo-1531218150217-54595bc2b934?w=800&fit=crop',
   'Live music capital of the world with world-class public golf'),
  ('d1ec0001-0000-0000-0000-000000000002',
   'Nashville, TN', 'Nashville', 'TN', 'US', 36.1627, -86.7816,
   'https://images.unsplash.com/photo-1545310143-3b4e5c96d6e9?w=800&fit=crop',
   'Country music capital paired with championship resort courses'),
  ('d1ec0001-0000-0000-0000-000000000003',
   'Las Vegas, NV', 'Las Vegas', 'NV', 'US', 36.1699, -115.1398,
   'https://images.unsplash.com/photo-1581351721010-8cf859cb14a4?w=800&fit=crop',
   'World-class entertainment and premier desert resort golf')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Artists
-- -----------------------------------------------------------------------------
INSERT INTO public.artists (id, name, genre, subgenre, description)
VALUES
  ('a1ec0001-0000-0000-0000-000000000001',
   'Luke Combs', 'Country', 'Contemporary Country',
   'Multi-platinum country superstar known for sold-out arena tours and radio dominance'),
  ('a1ec0001-0000-0000-0000-000000000002',
   'Green Day', 'Rock', 'Punk Rock',
   'Legendary punk rock trio with decades of stadium-filling anthems'),
  ('a1ec0001-0000-0000-0000-000000000003',
   'Olivia Rodrigo', 'Pop', 'Pop Rock',
   'Grammy-winning pop sensation with one of the fastest-rising careers in music'),
  ('a1ec0001-0000-0000-0000-000000000004',
   'Chris Stapleton', 'Country', 'Outlaw Country',
   'Grammy Award-winning country and blues artist with electrifying live performances'),
  ('a1ec0001-0000-0000-0000-000000000005',
   'Metallica', 'Rock', 'Heavy Metal',
   'Iconic heavy metal band delivering legendary arena shows for over four decades'),
  ('a1ec0001-0000-0000-0000-000000000006',
   'Taylor Swift', 'Pop', 'Pop',
   'Record-breaking touring artist and the defining pop voice of her generation'),
  ('a1ec0001-0000-0000-0000-000000000007',
   'Morgan Wallen', 'Country', 'Country Pop',
   'Record-shattering country artist known for massive stadium and arena shows'),
  ('a1ec0001-0000-0000-0000-000000000008',
   'Foo Fighters', 'Rock', 'Alternative Rock',
   'Rock hall legends headlining festivals and arenas worldwide'),
  ('a1ec0001-0000-0000-0000-000000000009',
   'Billie Eilish', 'Pop', 'Indie Pop',
   'Grammy-winning pop artist known for intimate-feeling, visually stunning arena spectacles')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Venues (manually curated — no source/source_id so no UNIQUE conflict)
-- -----------------------------------------------------------------------------
INSERT INTO public.venues (
  id, name, city, state, country, address, capacity,
  venue_type, metro, active, lat, lng
)
VALUES
  ('b1ec0001-0000-0000-0000-000000000001',
   'Moody Center', 'Austin', 'TX', 'US',
   '2501 Pearce Rd, Austin, TX 78712', 15000,
   'arena', 'austin', true, 30.2856, -97.7362),
  ('b1ec0001-0000-0000-0000-000000000002',
   'Bridgestone Arena', 'Nashville', 'TN', 'US',
   '501 Broadway, Nashville, TN 37203', 20000,
   'arena', 'nashville', true, 36.1592, -86.7785),
  ('b1ec0001-0000-0000-0000-000000000003',
   'Dolby Live at MGM Grand', 'Las Vegas', 'NV', 'US',
   '3799 S Las Vegas Blvd, Las Vegas, NV 89109', 5200,
   'theater', 'las-vegas', true, 36.1021, -115.1705)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. Events  (illustrative dates — ticket links point to Ticketmaster searches)
-- -----------------------------------------------------------------------------
INSERT INTO public.events (
  id, name, artist_id, venue_id,
  event_date, event_time, timezone,
  ticket_url, min_price, max_price, availability_status
)
VALUES
  -- Austin
  ('e1ec0001-0000-0000-0000-000000000001',
   'Luke Combs – Austin, TX',
   'a1ec0001-0000-0000-0000-000000000001',
   'b1ec0001-0000-0000-0000-000000000001',
   '2026-06-06', '20:00:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Luke+Combs+Austin',
   95, 350, 'available'),

  ('e1ec0001-0000-0000-0000-000000000002',
   'Green Day – Austin, TX',
   'a1ec0001-0000-0000-0000-000000000002',
   'b1ec0001-0000-0000-0000-000000000001',
   '2026-07-11', '20:00:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Green+Day+Austin',
   85, 275, 'available'),

  ('e1ec0001-0000-0000-0000-000000000003',
   'Olivia Rodrigo – Austin, TX',
   'a1ec0001-0000-0000-0000-000000000003',
   'b1ec0001-0000-0000-0000-000000000001',
   '2026-08-08', '20:00:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Olivia+Rodrigo+Austin',
   110, 450, 'available'),

  -- Nashville
  ('e1ec0001-0000-0000-0000-000000000004',
   'Chris Stapleton – Nashville, TN',
   'a1ec0001-0000-0000-0000-000000000004',
   'b1ec0001-0000-0000-0000-000000000002',
   '2026-05-30', '20:00:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Chris+Stapleton+Nashville',
   125, 425, 'available'),

  ('e1ec0001-0000-0000-0000-000000000005',
   'Metallica – Nashville, TN',
   'a1ec0001-0000-0000-0000-000000000005',
   'b1ec0001-0000-0000-0000-000000000002',
   '2026-07-18', '20:00:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Metallica+Nashville',
   100, 350, 'available'),

  ('e1ec0001-0000-0000-0000-000000000006',
   'Taylor Swift – Nashville, TN',
   'a1ec0001-0000-0000-0000-000000000006',
   'b1ec0001-0000-0000-0000-000000000002',
   '2026-08-22', '19:30:00', 'America/Chicago',
   'https://www.ticketmaster.com/search?q=Taylor+Swift+Nashville',
   150, 600, 'available'),

  -- Las Vegas
  ('e1ec0001-0000-0000-0000-000000000007',
   'Morgan Wallen – Las Vegas, NV',
   'a1ec0001-0000-0000-0000-000000000007',
   'b1ec0001-0000-0000-0000-000000000003',
   '2026-06-13', '21:00:00', 'America/Los_Angeles',
   'https://www.ticketmaster.com/search?q=Morgan+Wallen+Las+Vegas',
   90, 325, 'available'),

  ('e1ec0001-0000-0000-0000-000000000008',
   'Foo Fighters – Las Vegas, NV',
   'a1ec0001-0000-0000-0000-000000000008',
   'b1ec0001-0000-0000-0000-000000000003',
   '2026-07-04', '21:00:00', 'America/Los_Angeles',
   'https://www.ticketmaster.com/search?q=Foo+Fighters+Las+Vegas',
   80, 260, 'available'),

  ('e1ec0001-0000-0000-0000-000000000009',
   'Billie Eilish – Las Vegas, NV',
   'a1ec0001-0000-0000-0000-000000000009',
   'b1ec0001-0000-0000-0000-000000000003',
   '2026-08-29', '21:00:00', 'America/Los_Angeles',
   'https://www.ticketmaster.com/search?q=Billie+Eilish+Las+Vegas',
   120, 480, 'available')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Featured Packages
--    Golf course IDs are the real catalog UUIDs loaded by refresh-catalog.
--    Prices reflect per-person weekend estimates (concert + golf; hotel separate).
-- -----------------------------------------------------------------------------
INSERT INTO public.packages (
  id, name, event_id, golf_course_id, destination_id,
  description, image_url,
  price, original_price,
  category, featured, active
)
VALUES
  -- ── Austin × Country ──────────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000001',
   'Luke Combs + Golf – Austin Weekend',
   'e1ec0001-0000-0000-0000-000000000001',
   'b099b173-2fda-4b79-b196-9f835d85d88c',
   'd1ec0001-0000-0000-0000-000000000001',
   'Country music and championship golf in the Live Music Capital. Catch Luke Combs at Moody Center, then hit the fairways at Star Ranch Golf Club.',
   'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&fit=crop',
   895, 1050, 'Golf + Concert', true, true),

  -- ── Austin × Rock ─────────────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000002',
   'Green Day + Golf – Austin Weekend',
   'e1ec0001-0000-0000-0000-000000000002',
   'b099b173-2fda-4b79-b196-9f835d85d88c',
   'd1ec0001-0000-0000-0000-000000000001',
   'Punk rock anthems and morning tee times in Austin. Green Day at Moody Center paired with a round at one of Austin''s top public courses.',
   'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&fit=crop',
   875, 995, 'Golf + Concert', true, true),

  -- ── Austin × Pop ──────────────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000003',
   'Olivia Rodrigo + Golf – Austin Weekend',
   'e1ec0001-0000-0000-0000-000000000003',
   'b099b173-2fda-4b79-b196-9f835d85d88c',
   'd1ec0001-0000-0000-0000-000000000001',
   'A pop-perfect Austin weekend — Olivia Rodrigo lighting up Moody Center, with a scenic round at Star Ranch Golf Club the next morning.',
   'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&fit=crop',
   925, 1095, 'Golf + Concert', true, true),

  -- ── Nashville × Country ───────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000004',
   'Chris Stapleton + Golf – Nashville Weekend',
   'e1ec0001-0000-0000-0000-000000000004',
   'fda2c5d9-a87b-4dab-8347-aaddee64a187',
   'd1ec0001-0000-0000-0000-000000000002',
   'World-class country music meets championship golf in Music City. Chris Stapleton at Bridgestone Arena, then a round at Gaylord Springs Golf Links.',
   'https://images.unsplash.com/photo-1508854710579-5cecc3a9ff17?w=800&fit=crop',
   975, 1150, 'Golf + Concert', true, true),

  -- ── Nashville × Rock ──────────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000005',
   'Metallica + Golf – Nashville Weekend',
   'e1ec0001-0000-0000-0000-000000000005',
   'fda2c5d9-a87b-4dab-8347-aaddee64a187',
   'd1ec0001-0000-0000-0000-000000000002',
   'Heavy metal and southern fairways — Metallica bringing the thunder at Bridgestone Arena, then a sunrise round at Gaylord Springs Golf Links.',
   'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&fit=crop',
   950, 1095, 'Golf + Concert', true, true),

  -- ── Nashville × Pop ───────────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000006',
   'Taylor Swift + Golf – Nashville Weekend',
   'e1ec0001-0000-0000-0000-000000000006',
   'fda2c5d9-a87b-4dab-8347-aaddee64a187',
   'd1ec0001-0000-0000-0000-000000000002',
   'The ultimate Nashville experience — Taylor Swift at the arena where she got her start, plus championship golf at Gaylord Springs Golf Links.',
   'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&fit=crop',
   1095, 1295, 'Golf + Concert', true, true),

  -- ── Las Vegas × Country ───────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000007',
   'Morgan Wallen + Golf – Las Vegas Weekend',
   'e1ec0001-0000-0000-0000-000000000007',
   '74fd4b12-c14d-4cb4-b7d7-89504acadf62',
   'd1ec0001-0000-0000-0000-000000000003',
   'Country meets the desert in Las Vegas — Morgan Wallen at Dolby Live, plus a premier round at Las Vegas Paiute Golf Resort.',
   'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&fit=crop',
   1195, 1395, 'Golf + Concert', true, true),

  -- ── Las Vegas × Rock ──────────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000008',
   'Foo Fighters + Golf – Las Vegas Weekend',
   'e1ec0001-0000-0000-0000-000000000008',
   '74fd4b12-c14d-4cb4-b7d7-89504acadf62',
   'd1ec0001-0000-0000-0000-000000000003',
   'Rock out under the Vegas lights — Foo Fighters at Dolby Live, followed by a sunrise round at Las Vegas Paiute Golf Resort.',
   'https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&fit=crop',
   1150, 1350, 'Golf + Concert', true, true),

  -- ── Las Vegas × Pop ───────────────────────────────────────────────────────
  ('f1ec0001-0000-0000-0000-000000000009',
   'Billie Eilish + Golf – Las Vegas Weekend',
   'e1ec0001-0000-0000-0000-000000000009',
   '74fd4b12-c14d-4cb4-b7d7-89504acadf62',
   'd1ec0001-0000-0000-0000-000000000003',
   'An unforgettable Vegas weekend — Billie Eilish''s breathtaking show at Dolby Live, plus a round at Las Vegas Paiute Golf Resort as the sun rises over the Mojave.',
   'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&fit=crop',
   1295, 1550, 'Golf + Concert', true, true)
ON CONFLICT (id) DO NOTHING;
