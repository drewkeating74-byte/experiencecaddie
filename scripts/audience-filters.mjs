/** Golf-weekend Instagram audience: men 25–55. Used by review-tool + discovery backfill. */

export const AUDIENCE_GENRES = [
  "country",
  "rock",
  "classic rock",
  "americana",
  "alternative",
  "indie",
];

export const AUDIENCE_SCORE_DEFAULT = 158;
export const AUDIENCE_SCORE_PREFERRED = 145;

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
  const list = AUDIENCE_GENRES.map((g) => `'${g.replace(/'/g, "''")}'`).join(", ");
  return `LOWER(COALESCE(${column}, '')) IN (${list})`;
}

export function audienceScoreSql(column = "ds.score", genreColumn = "ds.genre") {
  const preferred = AUDIENCE_GENRES.map((g) => `'${g.replace(/'/g, "''")}'`).join(", ");
  return `(
    ${column} >= ${AUDIENCE_SCORE_DEFAULT}
    OR (
      ${column} >= ${AUDIENCE_SCORE_PREFERRED}
      AND LOWER(COALESCE(${genreColumn}, '')) IN (${preferred})
    )
  )`;
}
