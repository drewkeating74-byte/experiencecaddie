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

export const AUDIENCE_SCORE_DEFAULT = 158;
export const AUDIENCE_SCORE_PREFERRED = 145;
export const AUDIENCE_SCORE_ALT_INDIE = 125;

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

/** Gold → silver → bronze for marketing package golf pairing (resort still excluded in WHERE). */
export function marketingGolfCourseOrderBySql() {
  const effectiveTier = `COALESCE(
    tier_hint,
    CASE
      WHEN normalized_quality_score >= 70 THEN 'gold'
      WHEN normalized_quality_score >= 50 THEN 'silver'
      ELSE 'bronze'
    END
  )`;
  return `CASE ${effectiveTier}
      WHEN 'gold' THEN 1
      WHEN 'silver' THEN 2
      WHEN 'bronze' THEN 3
      ELSE 4
    END ASC,
    normalized_quality_score DESC NULLS LAST,
    image_brightness_score ASC NULLS LAST,
    rating DESC NULLS LAST`;
}
