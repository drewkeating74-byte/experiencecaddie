-- =============================================================================
-- Replace San Antonio package with Phoenix/Scottsdale warm-weather package
--
-- Source: live Ticketmaster-backed search results gathered 2026-05-02.
-- Phoenix/Scottsdale is a core warm-weather golf market, especially for late
-- fall and winter trips, so this swaps the San Antonio slot for a November
-- Phoenix package paired with Ocotillo Golf Club.
-- =============================================================================

BEGIN;

UPDATE public.destinations
SET name = 'Phoenix, AZ',
    city = 'Phoenix',
    state = 'AZ',
    country = 'US',
    lat = 33.4484,
    lng = -112.0740,
    description = 'Phoenix and Scottsdale concert weekends paired with desert golf in prime warm-weather season.',
    updated_at = now()
WHERE id = 'd7ed0000-0000-0000-0000-000000000003';

UPDATE public.artists
SET name = 'Teddy Swims',
    genre = 'Pop',
    subgenre = 'Soul Pop',
    description = 'Teddy Swims is included in the seasonally balanced May 2026 curated package catalog from Ticketmaster-backed event data.',
    updated_at = now()
WHERE id = 'a7ed0000-0000-0000-0000-000000000004';

UPDATE public.venues
SET name = 'Mortgage Matchup Center',
    city = 'Phoenix',
    state = 'AZ',
    country = 'US',
    venue_type = 'arena',
    active = true,
    updated_at = now()
WHERE id = 'b7ed0000-0000-0000-0000-000000000004';

UPDATE public.events
SET name = 'Teddy Swims: The UGLY Tour',
    artist_id = 'a7ed0000-0000-0000-0000-000000000004',
    venue_id = 'b7ed0000-0000-0000-0000-000000000004',
    event_date = '2026-11-16',
    event_time = NULL,
    timezone = 'America/Phoenix',
    ticket_url = 'https://www.ticketmaster.com/teddy-swims-the-ugly-tour-phoenix-arizona-11-16-2026/event/1900648EA3255E97',
    availability_status = 'available',
    source_id = '1Av0Z_FGkBNa4B9',
    source_name = 'ticketmaster',
    updated_at = now()
WHERE id = 'e7ed0000-0000-0000-0000-000000000004';

UPDATE public.packages
SET name = 'Teddy Swims + Ocotillo Golf Club | Phoenix, AZ',
    event_id = 'e7ed0000-0000-0000-0000-000000000004',
    golf_course_id = (
      SELECT id
      FROM public.golf_courses
      WHERE source_id = 'ChIJ-WulxW0AK4cRTidVMac80Ug'
      ORDER BY active DESC NULLS LAST, updated_at DESC NULLS LAST
      LIMIT 1
    ),
    destination_id = 'd7ed0000-0000-0000-0000-000000000003',
    description = 'Teddy Swims: The UGLY Tour at Mortgage Matchup Center anchors a mainstream pop concert weekend in Phoenix, paired with a round at Ocotillo Golf Club. The event is confirmed through Ticketmaster and the golf pairing fits Phoenix/Scottsdale prime desert golf season.',
    image_url = 'https://s1.ticketm.net/dam/a/746/1541d4c3-9c17-400f-84f1-3017d9c9d746_SOURCE',
    price = 920,
    original_price = 1070,
    category = 'Golf + Concert',
    featured = false,
    active = true,
    expires_at = '2026-11-18T23:59:59Z',
    package_start_date = '2026-11-15',
    package_end_date = '2026-11-17',
    source = 'curated',
    artist_name = 'Teddy Swims',
    city = 'Phoenix',
    golf_course_name = 'Ocotillo Golf Club',
    verification_status = 'verified',
    verification_fail_count = 0,
    last_verification_at = now(),
    last_verification_source = 'ticketmaster',
    verification_notes = 'Confirmed Ticketmaster event 1Av0Z_FGkBNa4B9 for Teddy Swims: The UGLY Tour on 2026-11-16.',
    verification_evidence_url = 'https://www.ticketmaster.com/teddy-swims-the-ugly-tour-phoenix-arizona-11-16-2026/event/1900648EA3255E97',
    last_ticketmaster_check_at = now(),
    ticketmaster_last_ok = true,
    updated_at = now()
WHERE id = 'f7ed0000-0000-0000-0000-000000000004';

DO $$
DECLARE missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM public.packages
  WHERE id = 'f7ed0000-0000-0000-0000-000000000004'
    AND golf_course_id IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Phoenix package missing golf_course_id';
  END IF;
END $$;

COMMIT;
