-- Populate denormalized display columns for curated packages where they are null.
-- Packages page helpers (pkgCity, pkgArtistName, pkgGolfName) read these columns,
-- so cards were showing only name + price with no city/artist/date metadata.

-- Pattern A: "Artist + Golf Course | City, State"
-- e.g. "Kenny Chesney + Star Ranch | Austin, TX"
UPDATE packages
SET
  artist_name      = trim(split_part(name, ' + ', 1)),
  golf_course_name = trim(split_part(split_part(name, ' + ', 2), ' | ', 1)),
  city             = trim(split_part(split_part(name, ' | ', 2), ',', 1))
WHERE source      = 'curated'
  AND artist_name IS NULL
  AND name        LIKE '% | %';

-- Pattern B: "Artist + Golf – City Weekend"
-- e.g. "Taylor Swift + Golf – Nashville Weekend"
UPDATE packages
SET
  artist_name = trim(split_part(name, ' + Golf', 1)),
  city        = trim(regexp_replace(
                  split_part(name, ' – ', 2),
                  ' Weekend$', ''
                ))
WHERE source      = 'curated'
  AND artist_name IS NULL
  AND name        LIKE '% + Golf – % Weekend';
