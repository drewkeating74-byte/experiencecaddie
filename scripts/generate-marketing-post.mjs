/**
 * generate-marketing-post.mjs
 * ───────────────────────────
 * Generates Instagram carousel posts via BannerBear for active packages.
 *
 * BannerBear template set UID: 8D6okAWQ2BNrnNmXPl
 *
 * STATUS: STUB — full implementation pending when the marketing pipeline is
 * formalised.  The core query and image-quality filters below are final and
 * ready to use.
 *
 * Usage (future):
 *   node --env-file=.env scripts/generate-marketing-post.mjs [--dry-run] [--limit N]
 *
 * Environment variables needed:
 *   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE  — Postgres connection
 *   BANNERBEAR_API_KEY                              — BannerBear API key
 *
 * ─── Core query ──────────────────────────────────────────────────────────────
 *
 * SELECT p.name, p.artist_name, p.golf_course_name, p.city, p.event_name,
 *        COALESCE(a.fanartv_background_url,
 *                 a.spotify_image_url) AS concert_slide_bg,  -- live bg preferred, Spotify fallback
 *        e.event_date,
 *        gc.marketing_image_url AS course_photo,   -- darkest of img1/img2/img3
 *        gc.rating,
 *        gc.state
 * FROM   packages     p
 * JOIN   events       e  ON e.id  = p.event_id
 * JOIN   artists      a  ON a.id  = e.artist_id
 * JOIN   golf_courses gc ON gc.id = p.golf_course_id
 * WHERE  p.active  = true
 *   AND  e.active  = true                            -- excludes deactivated dupes
 *   AND  gc.marketing_image_url IS NOT NULL           -- scored by score-golf-images.mjs
 *   AND  e.image_brightness_score IS NOT NULL         -- scored by score-event-images.mjs
 *   AND  e.image_brightness_score <= 70               -- skip bright press headshots
 *   AND  COALESCE(a.fanartv_background_url, a.spotify_image_url) IS NOT NULL  -- at least one image source
 *   AND  e.event_date BETWEEN (CURRENT_DATE + INTERVAL '30 days')
 *                         AND (CURRENT_DATE + INTERVAL '180 days')
 * ORDER BY e.event_date ASC;
 *
 * Image quality notes:
 *   • COALESCE(a.fanartv_background_url, a.spotify_image_url) AS concert_slide_bg
 *     Primary: a.fanartv_background_url — wide-format live performance shot from
 *     Fanart.tv (backfilled by backfill-fanartv-images.mjs). 46/57 artists have one.
 *     Fallback: a.spotify_image_url — professional Spotify marketing photo
 *     (backfilled by backfill-spotify-images.mjs). 56/57 artists have one.
 *     Combined coverage: 47/57 artists have a Fanart.tv image; the remaining 10
 *     fall back to Spotify. Only Atomic Punks (tribute band) has neither.
 *   • gc.marketing_image_url   — chosen by score-golf-images.mjs as the darkest
 *     (lowest brightness score) of image_url / image_url_2 / image_url_3.
 *     Prefer this over gc.image_url for BannerBear course-photo slots.
 *   • e.image_brightness_score — computed by score-event-images.mjs.
 *     Events scoring > 70 are likely press headshots on white/grey backgrounds.
 *     The WHERE guard above excludes them; fall back to a dark placeholder if
 *     you ever need to include them.
 *   • Re-score cadence: run score-golf-images.mjs / score-event-images.mjs
 *     whenever new courses or events are ingested (IS NULL guard makes them
 *     idempotent — only unscored rows are touched).
 *   • Re-image cadence: run backfill-spotify-images.mjs after new artists are
 *     added (IS NULL guard — skips already-populated rows automatically).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

throw new Error(
  "generate-marketing-post.mjs is a stub. Implement the BannerBear API calls before running."
);
