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
