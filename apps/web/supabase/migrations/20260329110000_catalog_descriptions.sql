-- Add editorial description columns to golf_courses and venues.
-- short_description: one sentence shown in itinerary results and course cards.
-- vibe: 2-4 word label (e.g. "Upscale Hill Country", "Classic city muni").
ALTER TABLE public.golf_courses
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS vibe text;

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS short_description text;

-- ─── Austin golf course descriptions ─────────────────────────────────────────
UPDATE public.golf_courses SET
  short_description = 'Historic 1930s city muni open to all — great value rounds on a classic Austin layout.',
  vibe = 'Historic city muni'
WHERE metro = 'austin' AND name = 'Lions Municipal Golf Course';

UPDATE public.golf_courses SET
  short_description = 'Well-maintained semi-private in Hutto with strong community reviews and walk-on access.',
  vibe = 'Semi-private, solid value'
WHERE metro = 'austin' AND name = 'The Golf Club at Star Ranch';

UPDATE public.golf_courses SET
  short_description = '36-hole public facility in Round Rock — popular for weekend rounds and beginner-friendly.',
  vibe = '36-hole public complex'
WHERE metro = 'austin' AND name = 'Forest Creek Golf Club';

UPDATE public.golf_courses SET
  short_description = 'University-managed Bermuda-grass course with a collegiate feel and strong afternoon pace.',
  vibe = 'Collegiate public course'
WHERE metro = 'austin' AND name = 'UT Golf Club';

UPDATE public.golf_courses SET
  short_description = 'Upscale Hill Country course with dramatic views — one of Austin''s best public-access rounds.',
  vibe = 'Upscale Hill Country'
WHERE metro = 'austin' AND name = 'Spanish Oaks Golf Club';

UPDATE public.golf_courses SET
  short_description = 'Tom Fazio-designed resort course on the Barton Creek greenbelt — signature layout, resort rates.',
  vibe = 'Resort Fazio design'
WHERE metro = 'austin' AND name = 'Barton Creek Fazio Canyons Golf Course';

UPDATE public.golf_courses SET
  short_description = 'Friendly city muni near downtown Austin — great for a quick morning round before a show.',
  vibe = 'Affordable city muni'
WHERE metro = 'austin' AND name = 'Hancock Golf Course';

UPDATE public.golf_courses SET
  short_description = 'City-owned Roy Kizer offers a challenging layout with good conditions at a budget price.',
  vibe = 'Budget public course'
WHERE metro = 'austin' AND name = 'Roy Kizer Golf Course';

UPDATE public.golf_courses SET
  short_description = 'Well-regarded Hill Country club with resort amenities and reliable tee-time availability.',
  vibe = 'Hill Country resort club'
WHERE metro = 'austin' AND name = 'Kissing Tree Golf Club';

-- ─── Nashville golf course descriptions ──────────────────────────────────────
UPDATE public.golf_courses SET
  short_description = 'Rolling Tennessee parkland with bentgrass greens and reliable open-to-public access.',
  vibe = 'Classic Tennessee parkland'
WHERE metro = 'nashville' AND name = 'Nashville National Golf Links';

UPDATE public.golf_courses SET
  short_description = 'Upscale resort course on the Cumberland River — consistent conditions and scenic water views.',
  vibe = 'Upscale river resort'
WHERE metro = 'nashville' AND name = 'Gaylord Springs Golf Links';

UPDATE public.golf_courses SET
  short_description = 'Championship-caliber design in a master-planned community south of Nashville; walk-on friendly.',
  vibe = 'Championship community course'
WHERE metro = 'nashville' AND name = 'Westhaven Golf Club';

UPDATE public.golf_courses SET
  short_description = 'Well-loved 36-hole public complex east of downtown — one of Nashville''s most-played facilities.',
  vibe = '36-hole public facility'
WHERE metro = 'nashville' AND name = 'Hermitage Golf Course';

UPDATE public.golf_courses SET
  short_description = 'Affordable metro park muni in Percy Warner Park — beautiful tree-lined fairways.',
  vibe = 'City park muni'
WHERE metro = 'nashville' AND name = 'Percy Warner Golf Course';

UPDATE public.golf_courses SET
  short_description = 'Historic muni that played a pivotal role in Nashville golf history — affordable and welcoming.',
  vibe = 'Historic city course'
WHERE metro = 'nashville' AND name = 'Ted Rhodes Golf Course';

UPDATE public.golf_courses SET
  short_description = 'City-managed McCabe is a beginner-friendly layout with low green fees and central location.',
  vibe = 'Budget city muni'
WHERE metro = 'nashville' AND name = 'McCabe Golf Course';

-- ─── Las Vegas golf course descriptions ──────────────────────────────────────
UPDATE public.golf_courses SET
  short_description = '36 holes of dramatic desert golf — Snow Mountain and Sun Mountain courses; one of Vegas''s best public facilities.',
  vibe = 'Premier desert public resort'
WHERE metro = 'las-vegas' AND name = 'Las Vegas Paiute Golf Resort';

UPDATE public.golf_courses SET
  short_description = 'Historic Strip-adjacent course dating to the 1960s — walkable, affordable, and great for a morning round.',
  vibe = 'Historic Strip classic'
WHERE metro = 'las-vegas' AND name = 'Las Vegas National Golf Course';

UPDATE public.golf_courses SET
  short_description = 'Exclusive Wynn resort course on the Strip — impeccable conditioning, open to resort guests.',
  vibe = 'Ultra-premium Strip resort'
WHERE metro = 'las-vegas' AND name = 'Wynn Golf Club';

UPDATE public.golf_courses SET
  short_description = 'Tropical-themed course right on the Strip — accessible walk-on play with a unique lush layout.',
  vibe = 'Tropical Strip course'
WHERE metro = 'las-vegas' AND name = 'Bali Hai Golf Club';

UPDATE public.golf_courses SET
  short_description = 'Tom Fazio-designed ultra-premium MGM course — widely ranked among the best in the US.',
  vibe = 'Ultra-exclusive premium'
WHERE metro = 'las-vegas' AND name = 'Shadow Creek Golf Course';

UPDATE public.golf_courses SET
  short_description = 'TPC network course in the northwest valley — solid PGA-standard conditioning year-round.',
  vibe = 'TPC network course'
WHERE metro = 'las-vegas' AND name = 'TPC Las Vegas';

UPDATE public.golf_courses SET
  short_description = 'Affordable public course in Henderson with good mountain views and a friendly pace of play.',
  vibe = 'Value Henderson course'
WHERE metro = 'las-vegas' AND name = 'Highland Falls Golf Club';

UPDATE public.golf_courses SET
  short_description = 'Beautiful lakeside course at Lake Las Vegas — resort conditions with stunning water backdrops.',
  vibe = 'Lakeside resort course'
WHERE metro = 'las-vegas' AND name = 'Reflection Bay Golf Club';

-- ─── Main venues — short descriptions ────────────────────────────────────────
UPDATE public.venues SET short_description = 'Multi-purpose arena on the Strip — home to major touring acts and residencies'
WHERE city = 'Las Vegas' AND name ILIKE '%T-Mobile%';

UPDATE public.venues SET short_description = 'Iconic outdoor amphitheater on the shores of Lake Las Vegas'
WHERE city = 'Las Vegas' AND name ILIKE '%Amp%';

UPDATE public.venues SET short_description = 'Premier indoor arena and entertainment destination in downtown Nashville'
WHERE city = 'Nashville' AND name ILIKE '%Bridgestone%';

UPDATE public.venues SET short_description = 'Outdoor amphitheater and live music hub in Antioch, TN'
WHERE city = 'Nashville' AND (name ILIKE '%FirstBank%' OR name ILIKE '%Starwood%');

UPDATE public.venues SET short_description = 'Austin''s largest indoor arena hosting major national tours'
WHERE city = 'Austin' AND name ILIKE '%Moody Center%';

UPDATE public.venues SET short_description = 'Iconic outdoor venue on the shores of Lake Travis with country and rock lineups'
WHERE city = 'Austin' AND name ILIKE '%Stubb%';
