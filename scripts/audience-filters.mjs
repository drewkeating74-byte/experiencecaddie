/** Golf-weekend Instagram audience: men 25–55. Used by review-tool + discovery backfill. */

export const AUDIENCE_GENRES = [
  "country",
  "rock",
  "classic rock",
  "americana",
  "alternative",
  "indie",
  "folk",
  "singer-songwriter",
  "jam band",
];

/** Lower discovery score bar for genres that TM often under-scores. */
export const AUDIENCE_GENRES_LOW_SCORE = ["alternative", "indie"];

export const AUDIENCE_SCORE_DEFAULT = 148;
export const AUDIENCE_SCORE_PREFERRED = 135;
export const AUDIENCE_SCORE_ALT_INDIE = 115;

/** Instagram / marketing packages: silver-tier floor (matches itinerary SILVER bar). */
export const MARKETING_MIN_QUALITY_SCORE = 50;
export const MARKETING_MIN_RATING = 4.0;
export const MARKETING_MIN_HOLES = 18;

/** Quality score is authoritative; tier_hint may be stale (e.g. bronze with Q≥50). */
export function effectiveGolfTierSql(tableAlias = "") {
  const p = tableAlias ? `${tableAlias}.` : "";
  return `CASE
    WHEN ${p}normalized_quality_score >= 70 THEN 'gold'
    WHEN ${p}normalized_quality_score >= 50 THEN 'silver'
    WHEN ${p}tier_hint IS NOT NULL THEN ${p}tier_hint
    ELSE 'bronze'
  END`;
}

export function scoreDerivedGolfTier(course) {
  const qs = course?.normalized_quality_score ?? course?.course_quality_score;
  if (qs != null && qs >= 70) return "gold";
  if (qs != null && qs >= 50) return "silver";
  return course?.tier_hint ?? course?.course_tier_hint ?? "bronze";
}

/** SQL AND-clauses for marketing golf pairing — 18 holes, silver+ quality, no bronze. */
export function marketingGolfCourseWhereSql(tableAlias = "") {
  const p = tableAlias ? `${tableAlias}.` : "";
  const tier = effectiveGolfTierSql(tableAlias);
  return `
    AND COALESCE(${p}holes, ${MARKETING_MIN_HOLES}) >= ${MARKETING_MIN_HOLES}
    AND COALESCE(${p}normalized_quality_score, 0) >= ${MARKETING_MIN_QUALITY_SCORE}
    AND (${p}rating IS NULL OR ${p}rating >= ${MARKETING_MIN_RATING})
    AND ${tier} IN ('silver', 'gold')
  `.trim();
}

/** Name heuristics shared by review-tool + seed scripts (18-hole traditional courses only). */
export function marketingCourseNameIsPlayable(name) {
  const n = (name || "").toLowerCase();
  if (/topgolf|top\s*golf/i.test(n)) return false;
  if (/driving\s*range/i.test(n)) return false;
  if (/mini\s*golf|minigolf|putt-?putt|pitch\s*and\s*putt|executive\s*course/i.test(n)) return false;
  if (/simulator|indoor\s*golf|golf\s*simulator/i.test(n)) return false;
  if (/military|naval|navy|marine\s*corps|air\s*force|army|coast\s*guard|\bbase\b|\bmwr\b|\bdod\b/i.test(n)) return false;
  if (/8[\s-]?hole|eight[\s-]?hole|9[\s-]?hole|nine[\s-]?hole|par[\s-]?3\b|par[\s-]?27/i.test(n)) return false;
  if (/putting\s*(green|edge|course)|adventure\s*golf|footgolf|disc\s*golf/i.test(n)) return false;
  if (/academy|instruction|lessons?\b|golf\s*school/i.test(n) && !/course|club|resort|links/i.test(n)) return false;
  if (/\bfive\s*iron\b/i.test(n)) return false;
  if (/\bcity\s*golf\b/i.test(n)) return false;
  if (/\bbig\s*shots?\s*golf\b/i.test(n)) return false;
  if (/\bpopstroke\b/i.test(n)) return false;
  if (/\bx-golf\b|\bxgolf\b/i.test(n)) return false;
  if (/\bputtery\b/i.test(n)) return false;
  if (/golf\s*lounge/i.test(n)) return false;
  if (/lounge.*golf|bar.*golf/i.test(n)) return false;
  return true;
}

export function marketingCourseRecordIsPlayable(course) {
  if (!course?.name || !marketingCourseNameIsPlayable(course.name)) return false;
  const holes = course.holes;
  if (holes != null && holes < MARKETING_MIN_HOLES) return false;
  const qs = course.normalized_quality_score;
  if (qs != null && qs < MARKETING_MIN_QUALITY_SCORE) return false;
  const rating = course.rating;
  if (rating != null && rating < MARKETING_MIN_RATING) return false;
  return true;
}

/** Prefer silver-tier courses for Instagram (mid-market); gold as fallback. Never bronze. */
export function marketingGolfCourseOrderBySql({ preferSilver = true } = {}) {
  const effectiveTier = effectiveGolfTierSql("");
  const tierOrder = preferSilver
    ? `WHEN 'silver' THEN 1 WHEN 'gold' THEN 2`
    : `WHEN 'gold' THEN 1 WHEN 'silver' THEN 2`;
  return `CASE ${effectiveTier}
      ${tierOrder}
      WHEN 'bronze' THEN 3
      ELSE 4
    END ASC,
    normalized_quality_score DESC NULLS LAST,
    rating DESC NULLS LAST,
    user_rating_count DESC NULLS LAST,
    image_brightness_score ASC NULLS LAST`;
}

/** Golf-weekend metros — shown in review-tool city filter (alphabetical). */
export const FEATURED_CITIES = [
  "Atlanta", "Austin", "Boston", "Charleston", "Charlotte", "Chicago",
  "Dallas", "Denver", "Detroit", "Fort Lauderdale", "Houston", "Indianapolis",
  "Kansas City", "Las Vegas", "Los Angeles", "Miami", "Minneapolis",
  "Nashville", "New Orleans", "New York", "Philadelphia", "Phoenix",
  "Portland", "Sacramento", "Salt Lake City", "San Antonio", "San Diego",
  "San Francisco", "Seattle", "Tampa", "Washington",
];

export const TARGET_AUDIENCE_ARTISTS = [
  "Widespread Panic",
  "AJR",
  "The Avett Brothers",
  "Eric Church",
  "String Cheese Incident",
  "Sombr",
  "Parker McCollum",
  "Dead & Company",
  "Dave Matthews Band",
  "Luke Combs",
  "Chris Stapleton",
  "Zach Bryan",
  "Billy Strings",
  "Trey Anastasio",
  "Gov't Mule",
];

export function audienceGenreSql(column = "genre") {
  return `LOWER(COALESCE(${column}, '')) IN (${sqlGenreList(AUDIENCE_GENRES)})`;
}

function sqlGenreList(genres) {
  return genres.map((g) => `'${g.replace(/'/g, "''")}'`).join(", ");
}

export function audienceGenreLabel() {
  const title = (s) =>
    s.split(" ").map((w) =>
      w.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("-")
    ).join(" ");
  const labels = AUDIENCE_GENRES.map(title);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
}

export function audienceScoreSql(column = "ds.score", genreColumn = "ds.genre") {
  const preferred = sqlGenreList(AUDIENCE_GENRES);
  const lowScore = sqlGenreList(AUDIENCE_GENRES_LOW_SCORE);
  return `(
    ${column} >= ${AUDIENCE_SCORE_DEFAULT}
    OR (
      ${column} >= ${AUDIENCE_SCORE_PREFERRED}
      AND LOWER(COALESCE(${genreColumn}, '')) IN (${preferred})
    )
    OR (
      ${column} >= ${AUDIENCE_SCORE_ALT_INDIE}
      AND LOWER(COALESCE(${genreColumn}, '')) IN (${lowScore})
    )
  )`;
}
