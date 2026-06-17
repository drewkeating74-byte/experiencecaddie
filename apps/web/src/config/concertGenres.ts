/**
 * Genres shown in the Experience Builder and used in discover_concerts filtering.
 * Keep in sync with DEFAULT_SURPRISE_GENRES in supabase/functions/_shared/ticketmaster.ts
 */
export const CONCERT_GENRES = [
  "Country",
  "Rock",
  "Classic Rock",
  "Pop",
  "Alternative",
  "Indie",
  "Jam Band",
  "Americana",
  "Folk",
  "Latin",
  "EDM",
  "Blues",
] as const;

export type ConcertGenre = (typeof CONCERT_GENRES)[number];
