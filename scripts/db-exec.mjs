/**
 * One-off SQL runner for the golf-course photo backfill work.
 *
 * Connects using standard PG* env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD,
 * PGDATABASE) so the password never has to live in a committed file or be
 * URL-encoded. Pass a label + SQL via argv, e.g.:
 *
 *   node scripts/db-exec.mjs migrate
 *   node scripts/db-exec.mjs scope
 */
import pg from "pg";

const TASK = process.argv[2];

const SQL = {
  migrate: `
    ALTER TABLE public.golf_courses
      ADD COLUMN IF NOT EXISTS image_url_2 text NULL,
      ADD COLUMN IF NOT EXISTS image_url_3 text NULL;
  `,
  scope: `
    SELECT
      count(*)                                    AS total,
      count(place_id)                             AS has_place_id,
      count(image_url)                            AS already_has_photo,
      count(place_id) - count(image_url)          AS needs_backfill
    FROM public.golf_courses;
  `,
  verify_columns: `
    SELECT column_name, data_type, is_nullable, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'golf_courses'
      AND column_name IN ('image_url', 'image_url_2', 'image_url_3')
    ORDER BY ordinal_position;
  `,
  all_columns: `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'golf_courses'
    ORDER BY ordinal_position;
  `,
  events_columns: `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
    ORDER BY ordinal_position;
  `,
  artists_columns: `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'artists'
    ORDER BY ordinal_position;
  `,
  events_tm_sample: `
    SELECT id, name, source_name, source_id, artist_id, image_url
    FROM public.events
    WHERE source_name = 'ticketmaster' AND source_id IS NOT NULL
    LIMIT 6;
  `,
  events_scope_tm: `
    SELECT
      count(*)                                                       AS total,
      count(source_id)                                               AS has_source_id,
      count(image_url)                                               AS already_has_photo,
      count(*) FILTER (WHERE source_name = 'ticketmaster')           AS ticketmaster_rows,
      count(*) FILTER (WHERE source_name = 'ticketmaster'
                         AND source_id IS NOT NULL
                         AND image_url IS NULL)                      AS eligible,
      count(*) FILTER (WHERE source_name = 'ticketmaster'
                         AND artist_id IS NULL)                      AS tm_rows_no_artist
    FROM public.events;
  `,
  concert_post_backfill: `
    SELECT
      (SELECT count(*) FROM public.events
         WHERE source_name = 'ticketmaster')                         AS tm_events,
      (SELECT count(image_url) FROM public.events
         WHERE source_name = 'ticketmaster')                         AS tm_events_with_image,
      (SELECT count(*) FROM public.events
         WHERE source_name = 'ticketmaster' AND image_url IS NULL)   AS tm_events_still_null,
      (SELECT count(*) FROM public.artists)                          AS artists_total,
      (SELECT count(image_url) FROM public.artists)                  AS artists_with_image
  `,
  concert_missing: `
    SELECT e.id, e.name, e.source_id, e.event_date, e.ticket_url, a.name AS artist
    FROM public.events e
    LEFT JOIN public.artists a ON a.id = e.artist_id
    WHERE e.source_name = 'ticketmaster' AND e.image_url IS NULL
    ORDER BY e.event_date;
  `,
  fk_to_events: `
    SELECT tc.table_name, kcu.column_name, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'events'
    ORDER BY tc.table_name;
  `,
  billy_rows: `
    SELECT e.id, e.name, e.source_id, e.event_date, e.image_url, e.venue_id, e.created_at,
           (SELECT count(*) FROM public.packages p WHERE p.event_id = e.id) AS package_refs
    FROM public.events e
    WHERE e.source_id = 'G5eVZb3cBovL6' OR (e.name ILIKE '%Billy Joel%' AND e.name ILIKE '%Sting%')
    ORDER BY e.created_at, e.id;
  `,
  concert_image_samples: `
    SELECT name, event_date::date AS date, image_url
    FROM public.events
    WHERE source_name = 'ticketmaster' AND image_url IS NOT NULL
    ORDER BY event_date
    LIMIT 8;
  `,
  fk_to_packages: `
    SELECT tc.table_name, kcu.column_name, rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'packages'
    ORDER BY tc.table_name;
  `,
  billy_package_refs: `
    SELECT p.id AS package_id, p.name, p.active, p.event_id,
      (SELECT count(*) FROM public.bookings b WHERE b.package_id = p.id) AS booking_refs
    FROM public.packages p
    WHERE p.event_id = 'e7ed0000-0000-0000-0000-000000000018';
  `,
  billy_delete: `
    DELETE FROM public.events WHERE id = 'e7ed0000-0000-0000-0000-000000000018';
  `,
  billy_verify_gone: `
    SELECT
      (SELECT count(*) FROM public.events   WHERE id = 'e7ed0000-0000-0000-0000-000000000018') AS event_left,
      (SELECT count(*) FROM public.packages WHERE id = 'f7ed0000-0000-0000-0000-000000000018') AS package_left,
      (SELECT count(*) FROM public.events   WHERE name ILIKE '%Billy Joel%')                    AS any_billy_events;
  `,
  events_page_view: `
    SELECT
      count(*)                                                AS upcoming_total,
      count(image_url)                                        AS with_image,
      count(*) FILTER (WHERE image_url IS NULL)               AS missing_image,
      count(*) FILTER (WHERE source_name = 'ticketmaster')    AS tm_rows,
      count(*) FILTER (WHERE source_name IS NULL)             AS seeded_rows
    FROM public.events
    WHERE event_date >= current_date;
  `,
  events_dupes: `
    SELECT lower(name) AS name, count(*) AS rows,
           count(DISTINCT event_date) AS distinct_dates,
           count(DISTINCT venue_id)   AS distinct_venues
    FROM public.events
    WHERE event_date >= current_date
    GROUP BY lower(name)
    HAVING count(*) > 1
    ORDER BY count(*) DESC, name;
  `,
  dup_blast_radius: `
    WITH grp AS (
      SELECT e.id, lower(e.name) AS lname, e.event_date,
             count(*) OVER (PARTITION BY lower(e.name), e.event_date) AS cnt
      FROM public.events e
      WHERE e.event_date >= current_date
    )
    SELECT
      (SELECT count(*) FROM grp WHERE cnt > 1)                                            AS dup_event_rows,
      (SELECT count(DISTINCT (lname, event_date)) FROM grp WHERE cnt > 1)                 AS dup_groups,
      (SELECT count(*) FROM public.packages p JOIN grp g ON p.event_id = g.id
         WHERE g.cnt > 1)                                                                 AS packages_on_dups,
      (SELECT count(*) FROM public.packages p JOIN grp g ON p.event_id = g.id
         WHERE g.cnt > 1 AND p.active = true)                                             AS active_packages_on_dups,
      (SELECT count(*) FROM public.bookings b
         JOIN public.packages p ON b.package_id = p.id
         JOIN grp g ON p.event_id = g.id WHERE g.cnt > 1)                                 AS bookings_on_dups
  `,
  dup_detail: `
    WITH grp AS (
      SELECT e.id, e.name, e.event_date, e.venue_id, e.image_url,
             count(*) OVER (PARTITION BY lower(e.name), e.event_date) AS cnt
      FROM public.events e
      WHERE e.event_date >= current_date
    )
    SELECT g.name, g.event_date::date AS date, g.id AS event_id,
           v.city AS venue_city,
           (g.image_url IS NOT NULL) AS has_image,
           p.id AS package_id, p.active AS pkg_active, p.city AS pkg_city
    FROM grp g
    LEFT JOIN public.venues v ON v.id = g.venue_id
    LEFT JOIN public.packages p ON p.event_id = g.id
    WHERE g.cnt > 1
    ORDER BY lower(g.name), g.event_date, v.city;
  `,
  dedupe_preview: `
    SELECT e.id, e.name, e.event_date::date AS date
    FROM public.events e
    WHERE e.event_date >= current_date
      AND NOT EXISTS (SELECT 1 FROM public.packages p WHERE p.event_id = e.id)
      AND EXISTS (
        SELECT 1 FROM public.events e3
        JOIN public.packages p3 ON p3.event_id = e3.id
        WHERE lower(e3.name) = lower(e.name) AND e3.event_date = e.event_date AND e3.id <> e.id
      )
    ORDER BY e.name, e.id;
  `,
  dedupe_execute: `
    DELETE FROM public.events e
    WHERE e.event_date >= current_date
      AND NOT EXISTS (SELECT 1 FROM public.packages p WHERE p.event_id = e.id)
      AND EXISTS (
        SELECT 1 FROM public.events e3
        JOIN public.packages p3 ON p3.event_id = e3.id
        WHERE lower(e3.name) = lower(e.name) AND e3.event_date = e.event_date AND e3.id <> e.id
      );
  `,
  packages_total: `SELECT count(*) AS packages, count(*) FILTER (WHERE active) AS active FROM public.packages;`,
  seeded_missing: `
    SELECT e.id, e.name, e.event_date::date AS date, e.artist_id,
           a.name AS artist, v.city AS venue_city, v.state AS venue_state
    FROM public.events e
    LEFT JOIN public.artists a ON a.id = e.artist_id
    LEFT JOIN public.venues v ON v.id = e.venue_id
    WHERE e.event_date >= current_date
      AND e.image_url IS NULL
      AND e.source_name IS DISTINCT FROM 'ticketmaster'
    ORDER BY e.event_date;
  `,
  dup_keys: `
    SELECT lower(e.name) AS name,
           count(*) AS rows,
           count(DISTINCT e.artist_id) AS distinct_artist_ids,
           count(DISTINCT a.name)      AS distinct_artist_names
    FROM public.events e
    LEFT JOIN public.artists a ON a.id = e.artist_id
    WHERE e.event_date >= current_date
    GROUP BY lower(e.name)
    HAVING count(*) > 1
    ORDER BY count(*) DESC, name;
  `,
  events_freshness: `
    SELECT
      count(*)                                                AS total,
      count(*) FILTER (WHERE event_date >= current_date)      AS upcoming,
      count(*) FILTER (WHERE event_date <  current_date)      AS past,
      count(image_url)                                        AS have_image_url,
      count(*) FILTER (WHERE source_name = 'ticketmaster')    AS from_ticketmaster,
      count(DISTINCT source_name)                             AS distinct_source_names,
      min(event_date)                                         AS earliest,
      max(event_date)                                         AS latest
    FROM public.events;
  `,
  placeid_probe: `
    SELECT
      count(*)                                                AS total,
      count(place_id)                                         AS place_id_nonnull,
      count(*) FILTER (WHERE place_id = '')                   AS place_id_empty,
      count(source_id)                                        AS source_id_nonnull,
      count(*) FILTER (WHERE source = 'google')               AS source_google,
      count(DISTINCT source)                                  AS distinct_sources
    FROM public.golf_courses;
  `,
  placeid_sample: `
    SELECT id, name, source, source_id, place_id, image_url
    FROM public.golf_courses
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 8;
  `,
  post_backfill: `
    SELECT
      count(*)                                              AS total,
      count(place_id)                                       AS place_id_filled,
      count(image_url)                                      AS img1,
      count(image_url_2)                                    AS img2,
      count(image_url_3)                                    AS img3,
      count(*) FILTER (WHERE image_url IS NULL)             AS still_no_photo,
      count(*) FILTER (WHERE image_url IS NOT NULL
                         AND image_url_2 IS NULL)           AS exactly_1,
      count(*) FILTER (WHERE image_url_2 IS NOT NULL
                         AND image_url_3 IS NULL)           AS exactly_2,
      count(*) FILTER (WHERE image_url_3 IS NOT NULL)       AS exactly_3
    FROM public.golf_courses
    WHERE source = 'google_places' AND source_id IS NOT NULL;
  `,
  source_breakdown: `
    SELECT source, count(*) AS n,
           count(source_id) AS with_source_id,
           count(place_id)  AS with_place_id
    FROM public.golf_courses
    GROUP BY source ORDER BY n DESC;
  `,
};

if (!SQL[TASK]) {
  console.error(`Unknown task "${TASK}". Options: ${Object.keys(SQL).join(", ")}`);
  process.exit(1);
}

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const res = await client.query(SQL[TASK]);
  if (Array.isArray(res)) {
    res.forEach((r) => console.table(r.rows ?? r.command));
  } else if (res.rows && res.rows.length) {
    console.table(res.rows);
  } else {
    console.log(`OK: ${res.command}${res.rowCount != null ? ` (${res.rowCount} rows)` : ""}`);
  }
} catch (err) {
  console.error("DB error:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
