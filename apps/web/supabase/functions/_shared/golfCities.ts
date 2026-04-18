/**
 * golfCities.ts — Experience Caddie: 29-Metro Catalog Config
 *
 * This is the single source of truth for which cities Experience Caddie
 * actively supports with an internal catalog of golf courses and venues.
 *
 * HOW IT'S USED:
 *  1. The itinerary builder checks this to decide whether to use our
 *     trusted internal database first, or fall back to live API calls.
 *  2. The refresh-catalog function loops over this list to know which
 *     metros to refresh, what coordinates to search around, and what
 *     Ticketmaster market to query.
 *  3. The search function uses METRO_BY_CITY to translate "Scottsdale" → "phoenix"
 *     so it can query the right DB rows.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsTerritoryRegion = "West" | "South" | "Midwest" | "Northeast";

export interface MetroConfig {
  /** Machine-readable key. Matches metro_areas.slug in Supabase. */
  slug: string;

  /** Human-readable label shown in UI, e.g. "Phoenix / Scottsdale, AZ" */
  label: string;

  /** Primary state abbreviation, e.g. "AZ" */
  state: string;

  /** Broad US region for display grouping */
  region: UsTerritoryRegion;

  /**
   * Every city name that belongs to this metro.
   * When a user types "Scottsdale" or "Tempe", we map it to the Phoenix metro
   * so the catalog DB query uses the right metro slug.
   */
  cities: string[];

  /** Geographic center of the metro — used as the origin for radius searches. */
  center: { lat: number; lng: number };

  /**
   * How far (in miles) from the center we search for golf courses and venues.
   * Tighter metros like Austin use 30; spread-out ones like DFW use 40.
   */
  searchRadiusMiles: number;

  /**
   * Ticketmaster Discovery API market name for this metro.
   * Passed as the `marketId` param when fetching upcoming concerts.
   * NOTE: Confirm exact IDs against TM API docs before going live.
   * Reference: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/#search-markets
   */
  ticketmasterMarket: string;

  /**
   * Ticketmaster DMA ID (numeric) for scoped event searches.
   * Set to null if not yet verified — the refresh job will fall back to
   * city-name search.
   */
  ticketmasterDmaId: number | null;

  /**
   * IANA timezone string for the metro, e.g. "America/Chicago".
   * Used to display event times correctly across time zones.
   */
  timezone: string;
}

// ---------------------------------------------------------------------------
// The 29 Metros
//
// Sequence:
//   1–20 — original catalog (launched Mar 2026)
//   21–29 — pilot expansion (added Apr 2026 for the pre-launch catalog flood:
//           NYC, Palm Springs, Orlando, Houston, San Antonio, Milwaukee,
//           Portland, Washington DC/NoVA, Kansas City)
//
// Caveat: search/index.ts filters golf_courses by state, so multi-state
// metros (DC, KC, Philly, NYC) will currently only surface courses matching
// the metro's primary `state` field. That's a known limitation; expand it
// later by dropping the state filter or making it accept an array.
// ---------------------------------------------------------------------------

export const METROS: MetroConfig[] = [
  {
    slug: "las-vegas",
    label: "Las Vegas, NV",
    state: "NV",
    region: "West",
    cities: ["Las Vegas", "Henderson", "North Las Vegas", "Summerlin", "Paradise", "Boulder City"],
    center: { lat: 36.1699, lng: -115.1398 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Las Vegas",
    ticketmasterDmaId: 319,
    timezone: "America/Los_Angeles",
  },
  {
    slug: "phoenix",
    label: "Phoenix / Scottsdale, AZ",
    state: "AZ",
    region: "West",
    cities: ["Phoenix", "Scottsdale", "Tempe", "Mesa", "Gilbert", "Chandler", "Peoria", "Glendale", "Surprise", "Goodyear"],
    center: { lat: 33.4942, lng: -111.9261 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Phoenix",
    ticketmasterDmaId: 402,
    timezone: "America/Phoenix",
  },
  {
    slug: "dallas",
    label: "Dallas–Fort Worth, TX",
    state: "TX",
    region: "South",
    cities: ["Dallas", "Fort Worth", "Irving", "Arlington", "Plano", "Frisco", "McKinney", "Allen", "Garland", "Richardson", "Denton"],
    center: { lat: 32.8481, lng: -97.0641 },
    searchRadiusMiles: 40,
    ticketmasterMarket: "Dallas",
    ticketmasterDmaId: 304,
    timezone: "America/Chicago",
  },
  {
    slug: "austin",
    label: "Austin, TX",
    state: "TX",
    region: "South",
    cities: ["Austin", "Round Rock", "Cedar Park", "Georgetown", "Pflugerville", "Kyle", "Buda", "San Marcos", "Lakeway"],
    center: { lat: 30.2672, lng: -97.7431 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Austin",
    ticketmasterDmaId: 303,
    timezone: "America/Chicago",
  },
  {
    slug: "nashville",
    label: "Nashville, TN",
    state: "TN",
    region: "South",
    cities: ["Nashville", "Brentwood", "Franklin", "Murfreesboro", "Hendersonville", "Smyrna", "Mt. Juliet", "Gallatin"],
    center: { lat: 36.1627, lng: -86.7816 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Nashville",
    ticketmasterDmaId: 434,
    timezone: "America/Chicago",
  },
  {
    slug: "atlanta",
    label: "Atlanta, GA",
    state: "GA",
    region: "South",
    cities: ["Atlanta", "Alpharetta", "Marietta", "Sandy Springs", "Roswell", "Dunwoody", "Peachtree City", "Buckhead", "Decatur"],
    center: { lat: 33.7490, lng: -84.3880 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Atlanta",
    ticketmasterDmaId: 324,
    timezone: "America/New_York",
  },
  {
    slug: "charlotte",
    label: "Charlotte, NC",
    state: "NC",
    region: "South",
    cities: ["Charlotte", "Concord", "Gastonia", "Rock Hill", "Huntersville", "Matthews", "Kannapolis", "Mooresville"],
    center: { lat: 35.2271, lng: -80.8431 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Charlotte",
    ticketmasterDmaId: 517,
    timezone: "America/New_York",
  },
  {
    slug: "tampa",
    label: "Tampa / St. Petersburg, FL",
    state: "FL",
    region: "South",
    cities: ["Tampa", "St. Petersburg", "Clearwater", "Brandon", "Lakeland", "Sarasota", "Bradenton", "Wesley Chapel"],
    center: { lat: 27.9506, lng: -82.4572 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Tampa",
    ticketmasterDmaId: 539,
    timezone: "America/New_York",
  },
  {
    slug: "miami",
    label: "Miami / Fort Lauderdale, FL",
    state: "FL",
    region: "South",
    cities: ["Miami", "Fort Lauderdale", "Boca Raton", "West Palm Beach", "Coral Gables", "Doral", "Hollywood", "Pompano Beach", "Aventura"],
    center: { lat: 26.0112, lng: -80.1494 },
    searchRadiusMiles: 40,
    ticketmasterMarket: "Miami",
    ticketmasterDmaId: 528,
    timezone: "America/New_York",
  },
  {
    slug: "san-diego",
    label: "San Diego, CA",
    state: "CA",
    region: "West",
    cities: ["San Diego", "Chula Vista", "La Jolla", "Escondido", "Oceanside", "Carlsbad", "El Cajon", "Encinitas", "Vista"],
    center: { lat: 32.7157, lng: -117.1611 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "San Diego",
    ticketmasterDmaId: 825,
    timezone: "America/Los_Angeles",
  },
  {
    slug: "los-angeles",
    label: "Los Angeles, CA",
    state: "CA",
    region: "West",
    cities: ["Los Angeles", "Pasadena", "Long Beach", "Burbank", "Glendale", "Torrance", "Santa Monica", "Anaheim", "Inglewood", "El Segundo"],
    center: { lat: 34.0195, lng: -118.4912 },
    searchRadiusMiles: 40,
    ticketmasterMarket: "Los Angeles",
    ticketmasterDmaId: 803,
    timezone: "America/Los_Angeles",
  },
  {
    slug: "san-francisco",
    label: "San Francisco Bay Area, CA",
    state: "CA",
    region: "West",
    cities: ["San Francisco", "Oakland", "San Jose", "Berkeley", "Fremont", "Santa Clara", "Palo Alto", "San Mateo", "Walnut Creek", "Concord"],
    center: { lat: 37.4419, lng: -122.1430 },
    searchRadiusMiles: 40,
    ticketmasterMarket: "San Francisco",
    ticketmasterDmaId: 807,
    timezone: "America/Los_Angeles",
  },
  {
    slug: "denver",
    label: "Denver, CO",
    state: "CO",
    region: "West",
    cities: ["Denver", "Aurora", "Lakewood", "Arvada", "Westminster", "Thornton", "Centennial", "Englewood", "Boulder", "Broomfield"],
    center: { lat: 39.7392, lng: -104.9903 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Denver",
    ticketmasterDmaId: 751,
    timezone: "America/Denver",
  },
  {
    slug: "seattle",
    label: "Seattle, WA",
    state: "WA",
    region: "West",
    cities: ["Seattle", "Bellevue", "Tacoma", "Redmond", "Kirkland", "Renton", "Bothell", "Issaquah", "Everett", "Kent"],
    center: { lat: 47.6062, lng: -122.3321 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Seattle",
    ticketmasterDmaId: 819,
    timezone: "America/Los_Angeles",
  },
  {
    slug: "chicago",
    label: "Chicago, IL",
    state: "IL",
    region: "Midwest",
    cities: ["Chicago", "Naperville", "Evanston", "Oak Park", "Schaumburg", "Aurora", "Joliet", "Waukegan", "Elgin"],
    center: { lat: 41.8781, lng: -87.6298 },
    searchRadiusMiles: 40,
    ticketmasterMarket: "Chicago",
    ticketmasterDmaId: 602,
    timezone: "America/Chicago",
  },
  {
    slug: "new-orleans",
    label: "New Orleans, LA",
    state: "LA",
    region: "South",
    cities: ["New Orleans", "Metairie", "Kenner", "Slidell", "Covington", "Mandeville", "Gretna", "Chalmette"],
    center: { lat: 29.9511, lng: -90.0715 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "New Orleans",
    ticketmasterDmaId: 622,
    timezone: "America/Chicago",
  },
  {
    slug: "boston",
    label: "Boston, MA",
    state: "MA",
    region: "Northeast",
    cities: ["Boston", "Cambridge", "Somerville", "Newton", "Quincy", "Brookline", "Worcester", "Lowell", "Waltham"],
    center: { lat: 42.3601, lng: -71.0589 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Boston",
    ticketmasterDmaId: 506,
    timezone: "America/New_York",
  },
  {
    slug: "philadelphia",
    label: "Philadelphia, PA",
    state: "PA",
    region: "Northeast",
    cities: ["Philadelphia", "Camden", "Wilmington", "Cherry Hill", "King of Prussia", "Conshohocken", "Media", "Norristown"],
    center: { lat: 39.9526, lng: -75.1652 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Philadelphia",
    ticketmasterDmaId: 504,
    timezone: "America/New_York",
  },
  {
    slug: "detroit",
    label: "Detroit, MI",
    state: "MI",
    region: "Midwest",
    cities: ["Detroit", "Ann Arbor", "Dearborn", "Warren", "Sterling Heights", "Pontiac", "Troy", "Livonia", "Royal Oak", "Farmington Hills"],
    center: { lat: 42.3314, lng: -83.0458 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Detroit",
    ticketmasterDmaId: 505,
    timezone: "America/Detroit",
  },
  {
    slug: "cleveland",
    label: "Cleveland, OH",
    state: "OH",
    region: "Midwest",
    cities: ["Cleveland", "Akron", "Parma", "Lakewood", "Strongsville", "Mentor", "Euclid", "Lorain", "Elyria"],
    center: { lat: 41.4993, lng: -81.6944 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Cleveland",
    ticketmasterDmaId: 510,
    timezone: "America/New_York",
  },
  // -------------------------------------------------------------------------
  // Apr 2026 pilot expansion — 9 new metros
  // -------------------------------------------------------------------------
  {
    slug: "new-york-city",
    label: "New York City, NY",
    state: "NY",
    region: "Northeast",
    cities: ["New York", "Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "Jersey City", "Newark", "Hoboken", "Long Island", "White Plains", "Yonkers", "Stamford"],
    center: { lat: 40.7128, lng: -74.0060 },
    searchRadiusMiles: 40,
    ticketmasterMarket: "New York",
    ticketmasterDmaId: 501,
    timezone: "America/New_York",
  },
  {
    slug: "palm-springs",
    label: "Greater Palm Springs, CA",
    state: "CA",
    region: "West",
    cities: ["Palm Springs", "Palm Desert", "Indian Wells", "La Quinta", "Rancho Mirage", "Cathedral City", "Indio", "Desert Hot Springs"],
    center: { lat: 33.8303, lng: -116.5453 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Palm Springs",
    ticketmasterDmaId: 804,
    timezone: "America/Los_Angeles",
  },
  {
    slug: "orlando",
    label: "Orlando, FL",
    state: "FL",
    region: "South",
    cities: ["Orlando", "Kissimmee", "Lake Buena Vista", "Winter Park", "Altamonte Springs", "Sanford", "Lake Mary", "Celebration", "Winter Garden", "Dr. Phillips"],
    center: { lat: 28.5383, lng: -81.3792 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Orlando",
    ticketmasterDmaId: 534,
    timezone: "America/New_York",
  },
  {
    slug: "houston",
    label: "Houston, TX",
    state: "TX",
    region: "South",
    cities: ["Houston", "The Woodlands", "Sugar Land", "Katy", "Pearland", "Spring", "Humble", "Missouri City", "Cypress", "Kingwood"],
    center: { lat: 29.7604, lng: -95.3698 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Houston",
    ticketmasterDmaId: 618,
    timezone: "America/Chicago",
  },
  {
    slug: "san-antonio",
    label: "San Antonio, TX",
    state: "TX",
    region: "South",
    cities: ["San Antonio", "Helotes", "Boerne", "Schertz", "Cibolo", "Universal City", "Alamo Heights", "Leon Valley", "New Braunfels"],
    center: { lat: 29.4241, lng: -98.4936 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "San Antonio",
    ticketmasterDmaId: 641,
    timezone: "America/Chicago",
  },
  {
    slug: "milwaukee",
    label: "Milwaukee, WI",
    state: "WI",
    region: "Midwest",
    cities: ["Milwaukee", "Brookfield", "Waukesha", "Wauwatosa", "West Allis", "Mequon", "Franklin", "Greenfield", "Oak Creek", "Menomonee Falls"],
    center: { lat: 43.0389, lng: -87.9065 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Milwaukee",
    ticketmasterDmaId: 617,
    timezone: "America/Chicago",
  },
  {
    slug: "portland",
    label: "Portland, OR",
    state: "OR",
    region: "West",
    cities: ["Portland", "Beaverton", "Hillsboro", "Gresham", "Tigard", "Lake Oswego", "West Linn", "Tualatin", "Oregon City", "Milwaukie"],
    center: { lat: 45.5051, lng: -122.6750 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Portland",
    ticketmasterDmaId: 820,
    timezone: "America/Los_Angeles",
  },
  {
    // DC metro spans DC + NoVA + suburban MD. Using 'VA' as the primary
    // state because Northern Virginia has the bulk of the public / daily-fee
    // catalog (TPC Potomac, RTJ Golf Club at Lansdowne, 1757 Golf Club, etc.).
    // Until we multi-state the state filter in search/index.ts, MD courses
    // (Congressional, Avenel, Renditions) will sit in the DB but not render
    // for DC metro searches.
    slug: "washington-dc",
    label: "Washington D.C. / Northern Virginia",
    state: "VA",
    region: "Northeast",
    cities: ["Washington", "Arlington", "Alexandria", "Bethesda", "Rockville", "Silver Spring", "Fairfax", "Reston", "Tysons", "McLean", "Chevy Chase", "Leesburg", "Ashburn"],
    center: { lat: 38.9072, lng: -77.0369 },
    searchRadiusMiles: 35,
    ticketmasterMarket: "Washington DC",
    ticketmasterDmaId: 511,
    timezone: "America/New_York",
  },
  {
    // KC metro is bi-state (MO + KS). Using 'MO' as primary to match the
    // existing pattern for multi-state metros. Overland Park / Olathe courses
    // will be limited until the search state filter is multi-state-aware.
    slug: "kansas-city",
    label: "Kansas City, MO/KS",
    state: "MO",
    region: "Midwest",
    cities: ["Kansas City", "Overland Park", "Olathe", "Lee's Summit", "Independence", "Shawnee", "Lenexa", "Blue Springs", "Leawood", "Prairie Village"],
    center: { lat: 39.0997, lng: -94.5786 },
    searchRadiusMiles: 30,
    ticketmasterMarket: "Kansas City",
    ticketmasterDmaId: 616,
    timezone: "America/Chicago",
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Fast O(1) lookup: city name (lowercased) → MetroConfig.
 * Example: METRO_BY_CITY["scottsdale"] → Phoenix metro config.
 */
export const METRO_BY_CITY: Record<string, MetroConfig> = Object.fromEntries(
  METROS.flatMap((m) => m.cities.map((c) => [c.toLowerCase(), m]))
);

/**
 * Fast O(1) lookup: slug → MetroConfig.
 * Example: METRO_BY_SLUG["austin"] → Austin metro config.
 */
export const METRO_BY_SLUG: Record<string, MetroConfig> = Object.fromEntries(
  METROS.map((m) => [m.slug, m])
);

/**
 * Returns the MetroConfig for a given city name, or null if the city
 * is not in any of the 20 supported metros.
 *
 * Usage in the itinerary builder:
 *   const metro = getMetroByCity(payload.city);
 *   if (metro) { // query catalog DB first }
 *   else        { // fall back to live API }
 */
export function getMetroByCity(city: string | undefined | null): MetroConfig | null {
  if (!city || city === "flexible" || city === "Various") return null;
  return METRO_BY_CITY[city.toLowerCase().trim()] ?? null;
}

/**
 * Returns the MetroConfig for a given slug, or null if not found.
 */
export function getMetroBySlug(slug: string | undefined | null): MetroConfig | null {
  if (!slug) return null;
  return METRO_BY_SLUG[slug.toLowerCase().trim()] ?? null;
}

/**
 * Returns true if the given city name is covered by the 20-metro catalog.
 * Used as a quick feature-flag check before attempting DB queries.
 */
export function isMetroSupported(city: string | undefined | null): boolean {
  return getMetroByCity(city) !== null;
}

/**
 * All city names across every metro, lowercased.
 * Useful for autocomplete and search validation.
 */
export const ALL_SUPPORTED_CITIES: string[] = METROS.flatMap((m) => m.cities);

/**
 * Returns metros grouped by region — handy for rendering a
 * "Pick your destination" selector with regional headers.
 */
export function getMetrosByRegion(): Record<UsTerritoryRegion, MetroConfig[]> {
  const grouped: Record<UsTerritoryRegion, MetroConfig[]> = {
    West: [],
    South: [],
    Midwest: [],
    Northeast: [],
  };
  for (const metro of METROS) {
    grouped[metro.region].push(metro);
  }
  return grouped;
}
