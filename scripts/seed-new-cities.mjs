/**
 * Seed featured packages for Phoenix, Dallas, and Denver.
 * 3 packages per city (country / rock / pop), each linked to a real
 * catalog golf course from the refresh-catalog run.
 *
 * Golf course IDs (from catalog):
 *   Phoenix  — TPC Scottsdale PGA:       07e83e12-28da-413c-9c57-d2cd51595671
 *   Dallas   — Waterchase Golf Club:     7cce4b09-9e7b-4f1c-9e7d-374551b518a5
 *   Denver   — Red Hawk Ridge GC:        02a07bc1-c7b7-4595-8ba8-d96b5cde9e48
 *
 * Run: node --env-file=.env scripts/seed-new-cities.mjs
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (never commit these).
 */

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in the environment (e.g. .env at repo root)."
  );
  process.exit(1);
}

const HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "resolution=ignore-duplicates",
};

async function upsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table}: ${res.status} ${text}`);
  }
  return res;
}

// ── DESTINATIONS ───────────────────────────────────────────────────────────
const destinations = [
  {
    id: "d1ec0001-0000-0000-0000-000000000004",
    name: "Phoenix / Scottsdale, AZ",
    city: "Phoenix",
    state: "AZ",
    country: "US",
    lat: 33.4484,
    lng: -112.074,
    image_url:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&fit=crop",
    description:
      "World-class desert golf and top-tier arena concerts in the Valley of the Sun",
  },
  {
    id: "d1ec0001-0000-0000-0000-000000000005",
    name: "Dallas / Fort Worth, TX",
    city: "Dallas",
    state: "TX",
    country: "US",
    lat: 32.7767,
    lng: -96.797,
    image_url:
      "https://images.unsplash.com/photo-1545194445-dddb8f4487c6?w=800&fit=crop",
    description:
      "Big-stage concerts and elite public courses in the heart of Texas",
  },
  {
    id: "d1ec0001-0000-0000-0000-000000000006",
    name: "Denver, CO",
    city: "Denver",
    state: "CO",
    country: "US",
    lat: 39.7392,
    lng: -104.9903,
    image_url:
      "https://images.unsplash.com/photo-1601158935942-52255782d322?w=800&fit=crop",
    description:
      "Iconic mountain-backdrop golf and legendary outdoor concert venues",
  },
];

// ── ARTISTS ────────────────────────────────────────────────────────────────
const artists = [
  // Phoenix
  {
    id: "a1ec0001-0000-0000-0000-00000000000a",
    name: "Zach Bryan",
    genre: "Country",
    subgenre: "Americana",
    description:
      "Breakout country-rock artist delivering raw, emotional arena shows",
  },
  {
    id: "a1ec0001-0000-0000-0000-00000000000b",
    name: "The Killers",
    genre: "Rock",
    subgenre: "Indie Rock",
    description:
      "Anthemic Las Vegas rock band with a massive global touring catalog",
  },
  {
    id: "a1ec0001-0000-0000-0000-00000000000c",
    name: "Bruno Mars",
    genre: "Pop",
    subgenre: "R&B / Pop",
    description:
      "Electrifying showman delivering non-stop hits with a full-band spectacular",
  },
  // Dallas
  {
    id: "a1ec0001-0000-0000-0000-00000000000d",
    name: "Lainey Wilson",
    genre: "Country",
    subgenre: "Country Pop",
    description:
      "CMA Entertainer of the Year with authentic grit and arena-filling energy",
  },
  {
    id: "a1ec0001-0000-0000-0000-00000000000e",
    name: "Post Malone",
    genre: "Hip-Hop / Rock",
    subgenre: "Genre-Bending Pop",
    description:
      "Texas-raised superstar who blends hip-hop, rock, and country into stadium spectacles",
  },
  {
    id: "a1ec0001-0000-0000-0000-00000000000f",
    name: "Beyoncé",
    genre: "Pop",
    subgenre: "R&B / Pop",
    description:
      "Global icon and Houston native whose productions are among the most spectacular in live music",
  },
  // Denver
  {
    id: "a1ec0001-0000-0000-0000-000000000010",
    name: "Kenny Chesney",
    genre: "Country",
    subgenre: "Country Rock",
    description:
      "Stadium country king whose outdoor shows pair perfectly with a weekend in the mountains",
  },
  {
    id: "a1ec0001-0000-0000-0000-000000000011",
    name: "Red Hot Chili Peppers",
    genre: "Rock",
    subgenre: "Alternative Rock",
    description:
      "Legendary LA rock band bringing high-energy funk-rock shows to stadiums worldwide",
  },
  {
    id: "a1ec0001-0000-0000-0000-000000000012",
    name: "Coldplay",
    genre: "Pop",
    subgenre: "Alternative Pop",
    description:
      "British rock icons known for breathtaking, colorful live productions and global mega-tours",
  },
];

// ── VENUES ─────────────────────────────────────────────────────────────────
const venues = [
  {
    id: "b1ec0001-0000-0000-0000-000000000004",
    name: "Footprint Center",
    city: "Phoenix",
    state: "AZ",
    country: "US",
    address: "201 E Jefferson St, Phoenix, AZ 85004",
    capacity: 18422,
    venue_type: "arena",
    metro: "phoenix",
    active: true,
    lat: 33.4457,
    lng: -112.0712,
  },
  {
    id: "b1ec0001-0000-0000-0000-000000000005",
    name: "American Airlines Center",
    city: "Dallas",
    state: "TX",
    country: "US",
    address: "2500 Victory Ave, Dallas, TX 75219",
    capacity: 20000,
    venue_type: "arena",
    metro: "dallas",
    active: true,
    lat: 32.7905,
    lng: -96.8103,
  },
  {
    id: "b1ec0001-0000-0000-0000-000000000006",
    name: "Ball Arena",
    city: "Denver",
    state: "CO",
    country: "US",
    address: "1000 Chopper Cir, Denver, CO 80204",
    capacity: 19099,
    venue_type: "arena",
    metro: "denver",
    active: true,
    lat: 39.7487,
    lng: -105.0077,
  },
];

// ── EVENTS ─────────────────────────────────────────────────────────────────
const events = [
  // Phoenix
  {
    id: "e1ec0001-0000-0000-0000-00000000000a",
    name: "Zach Bryan – Phoenix, AZ",
    artist_id: "a1ec0001-0000-0000-0000-00000000000a",
    venue_id: "b1ec0001-0000-0000-0000-000000000004",
    event_date: "2026-09-12",
    event_time: "20:00:00",
    timezone: "America/Phoenix",
    ticket_url: "https://www.ticketmaster.com/search?q=Zach+Bryan+Phoenix",
    min_price: 85,
    max_price: 325,
    availability_status: "available",
  },
  {
    id: "e1ec0001-0000-0000-0000-00000000000b",
    name: "The Killers – Phoenix, AZ",
    artist_id: "a1ec0001-0000-0000-0000-00000000000b",
    venue_id: "b1ec0001-0000-0000-0000-000000000004",
    event_date: "2026-10-03",
    event_time: "20:00:00",
    timezone: "America/Phoenix",
    ticket_url: "https://www.ticketmaster.com/search?q=The+Killers+Phoenix",
    min_price: 75,
    max_price: 285,
    availability_status: "available",
  },
  {
    id: "e1ec0001-0000-0000-0000-00000000000c",
    name: "Bruno Mars – Phoenix, AZ",
    artist_id: "a1ec0001-0000-0000-0000-00000000000c",
    venue_id: "b1ec0001-0000-0000-0000-000000000004",
    event_date: "2026-09-26",
    event_time: "20:00:00",
    timezone: "America/Phoenix",
    ticket_url: "https://www.ticketmaster.com/search?q=Bruno+Mars+Phoenix",
    min_price: 120,
    max_price: 475,
    availability_status: "available",
  },
  // Dallas
  {
    id: "e1ec0001-0000-0000-0000-00000000000d",
    name: "Lainey Wilson – Dallas, TX",
    artist_id: "a1ec0001-0000-0000-0000-00000000000d",
    venue_id: "b1ec0001-0000-0000-0000-000000000005",
    event_date: "2026-09-05",
    event_time: "20:00:00",
    timezone: "America/Chicago",
    ticket_url: "https://www.ticketmaster.com/search?q=Lainey+Wilson+Dallas",
    min_price: 80,
    max_price: 295,
    availability_status: "available",
  },
  {
    id: "e1ec0001-0000-0000-0000-00000000000e",
    name: "Post Malone – Dallas, TX",
    artist_id: "a1ec0001-0000-0000-0000-00000000000e",
    venue_id: "b1ec0001-0000-0000-0000-000000000005",
    event_date: "2026-10-10",
    event_time: "21:00:00",
    timezone: "America/Chicago",
    ticket_url: "https://www.ticketmaster.com/search?q=Post+Malone+Dallas",
    min_price: 90,
    max_price: 350,
    availability_status: "available",
  },
  {
    id: "e1ec0001-0000-0000-0000-00000000000f",
    name: "Beyoncé – Dallas, TX",
    artist_id: "a1ec0001-0000-0000-0000-00000000000f",
    venue_id: "b1ec0001-0000-0000-0000-000000000005",
    event_date: "2026-09-19",
    event_time: "20:00:00",
    timezone: "America/Chicago",
    ticket_url: "https://www.ticketmaster.com/search?q=Beyonce+Dallas",
    min_price: 150,
    max_price: 650,
    availability_status: "available",
  },
  // Denver
  {
    id: "e1ec0001-0000-0000-0000-000000000010",
    name: "Kenny Chesney – Denver, CO",
    artist_id: "a1ec0001-0000-0000-0000-000000000010",
    venue_id: "b1ec0001-0000-0000-0000-000000000006",
    event_date: "2026-08-15",
    event_time: "20:00:00",
    timezone: "America/Denver",
    ticket_url: "https://www.ticketmaster.com/search?q=Kenny+Chesney+Denver",
    min_price: 80,
    max_price: 280,
    availability_status: "available",
  },
  {
    id: "e1ec0001-0000-0000-0000-000000000011",
    name: "Red Hot Chili Peppers – Denver, CO",
    artist_id: "a1ec0001-0000-0000-0000-000000000011",
    venue_id: "b1ec0001-0000-0000-0000-000000000006",
    event_date: "2026-09-04",
    event_time: "20:00:00",
    timezone: "America/Denver",
    ticket_url:
      "https://www.ticketmaster.com/search?q=Red+Hot+Chili+Peppers+Denver",
    min_price: 95,
    max_price: 345,
    availability_status: "available",
  },
  {
    id: "e1ec0001-0000-0000-0000-000000000012",
    name: "Coldplay – Denver, CO",
    artist_id: "a1ec0001-0000-0000-0000-000000000012",
    venue_id: "b1ec0001-0000-0000-0000-000000000006",
    event_date: "2026-08-29",
    event_time: "20:00:00",
    timezone: "America/Denver",
    ticket_url: "https://www.ticketmaster.com/search?q=Coldplay+Denver",
    min_price: 130,
    max_price: 495,
    availability_status: "available",
  },
];

// ── PACKAGES ───────────────────────────────────────────────────────────────
// Golf IDs from catalog refresh:
//   Phoenix:  TPC Scottsdale PGA         07e83e12-28da-413c-9c57-d2cd51595671
//   Dallas:   Waterchase Golf Club       7cce4b09-9e7b-4f1c-9e7d-374551b518a5
//   Denver:   Red Hawk Ridge Golf Course 02a07bc1-c7b7-4595-8ba8-d96b5cde9e48
const GOLF = {
  phoenix: "07e83e12-28da-413c-9c57-d2cd51595671",
  dallas: "7cce4b09-9e7b-4f1c-9e7d-374551b518a5",
  denver: "02a07bc1-c7b7-4595-8ba8-d96b5cde9e48",
};

const packages = [
  // ── Phoenix ──────────────────────────────────────────────────────────────
  {
    id: "f1ec0001-0000-0000-0000-00000000000a",
    name: "Zach Bryan + Golf – Phoenix Weekend",
    event_id: "e1ec0001-0000-0000-0000-00000000000a",
    golf_course_id: GOLF.phoenix,
    destination_id: "d1ec0001-0000-0000-0000-000000000004",
    description:
      "Raw country energy meets world-class desert golf. Catch Zach Bryan at Footprint Center, then tee it up at TPC Scottsdale — home of the Waste Management Phoenix Open.",
    image_url:
      "https://images.unsplash.com/photo-1506157786151-b8491531f063?w=800&h=500&fit=crop",
    price: 1050,
    original_price: 1250,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },
  {
    id: "f1ec0001-0000-0000-0000-00000000000b",
    name: "The Killers + Golf – Phoenix Weekend",
    event_id: "e1ec0001-0000-0000-0000-00000000000b",
    golf_course_id: GOLF.phoenix,
    destination_id: "d1ec0001-0000-0000-0000-000000000004",
    description:
      "Anthemic rock under the desert sky. The Killers at Footprint Center plus a sunrise round at TPC Scottsdale — the best of Phoenix in one weekend.",
    image_url:
      "https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=800&h=500&fit=crop",
    price: 995,
    original_price: 1195,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },
  {
    id: "f1ec0001-0000-0000-0000-00000000000c",
    name: "Bruno Mars + Golf – Phoenix Weekend",
    event_id: "e1ec0001-0000-0000-0000-00000000000c",
    golf_course_id: GOLF.phoenix,
    destination_id: "d1ec0001-0000-0000-0000-000000000004",
    description:
      "Non-stop hits and championship fairways in the Valley of the Sun. Bruno Mars at Footprint Center and a round at TPC Scottsdale make this the ultimate Phoenix weekend.",
    image_url:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&h=500&fit=crop",
    price: 1195,
    original_price: 1395,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },

  // ── Dallas ────────────────────────────────────────────────────────────────
  {
    id: "f1ec0001-0000-0000-0000-00000000000d",
    name: "Lainey Wilson + Golf – Dallas Weekend",
    event_id: "e1ec0001-0000-0000-0000-00000000000d",
    golf_course_id: GOLF.dallas,
    destination_id: "d1ec0001-0000-0000-0000-000000000005",
    description:
      "The reigning CMA Entertainer of the Year live in Big D. Catch Lainey Wilson at American Airlines Center, then hit Waterchase Golf Club the next morning.",
    image_url:
      "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&h=500&fit=crop",
    price: 925,
    original_price: 1095,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },
  {
    id: "f1ec0001-0000-0000-0000-00000000000e",
    name: "Post Malone + Golf – Dallas Weekend",
    event_id: "e1ec0001-0000-0000-0000-00000000000e",
    golf_course_id: GOLF.dallas,
    destination_id: "d1ec0001-0000-0000-0000-000000000005",
    description:
      "Texas homecoming for Posty — Post Malone in Dallas with a round at Waterchase Golf Club, one of the DFW area's premier public courses.",
    image_url:
      "https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=800&h=500&fit=crop",
    price: 975,
    original_price: 1150,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },
  {
    id: "f1ec0001-0000-0000-0000-00000000000f",
    name: "Beyoncé + Golf – Dallas Weekend",
    event_id: "e1ec0001-0000-0000-0000-00000000000f",
    golf_course_id: GOLF.dallas,
    destination_id: "d1ec0001-0000-0000-0000-000000000005",
    description:
      "The greatest show on earth in her hometown. Beyoncé at American Airlines Center paired with championship golf at Waterchase — a weekend you'll talk about for years.",
    image_url:
      "https://images.unsplash.com/photo-1563841930606-67e2f5e06161?w=800&h=500&fit=crop",
    price: 1395,
    original_price: 1650,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },

  // ── Denver ────────────────────────────────────────────────────────────────
  {
    id: "f1ec0001-0000-0000-0000-000000000010",
    name: "Kenny Chesney + Golf – Denver Weekend",
    event_id: "e1ec0001-0000-0000-0000-000000000010",
    golf_course_id: GOLF.denver,
    destination_id: "d1ec0001-0000-0000-0000-000000000006",
    description:
      "Big stadium country and mountain golf — Kenny Chesney at Ball Arena followed by a sunrise round at Red Hawk Ridge with views of the Rockies.",
    image_url:
      "https://images.unsplash.com/photo-1574169208507-84376144848b?w=800&h=500&fit=crop",
    price: 995,
    original_price: 1195,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },
  {
    id: "f1ec0001-0000-0000-0000-000000000011",
    name: "Red Hot Chili Peppers + Golf – Denver Weekend",
    event_id: "e1ec0001-0000-0000-0000-000000000011",
    golf_course_id: GOLF.denver,
    destination_id: "d1ec0001-0000-0000-0000-000000000006",
    description:
      "High-altitude rock at its finest. RHCP bringing full-throttle funk-rock to Ball Arena, plus a morning round at Red Hawk Ridge Golf Course.",
    image_url:
      "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&h=500&fit=crop",
    price: 1045,
    original_price: 1225,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },
  {
    id: "f1ec0001-0000-0000-0000-000000000012",
    name: "Coldplay + Golf – Denver Weekend",
    event_id: "e1ec0001-0000-0000-0000-000000000012",
    golf_course_id: GOLF.denver,
    destination_id: "d1ec0001-0000-0000-0000-000000000006",
    description:
      "One of the most visually stunning shows in the world, set against a Rocky Mountain backdrop. Coldplay at Ball Arena plus Red Hawk Ridge Golf Course.",
    image_url:
      "https://images.unsplash.com/photo-1524368535928-5b5e00ddc76b?w=800&h=500&fit=crop",
    price: 1245,
    original_price: 1450,
    category: "Golf + Concert",
    featured: true,
    active: true,
  },
];

// ── RUN ────────────────────────────────────────────────────────────────────
async function run() {
  console.log("Seeding Phoenix, Dallas, Denver packages...\n");

  const steps = [
    ["destinations", destinations],
    ["artists", artists],
    ["venues", venues],
    ["events", events],
    ["packages", packages],
  ];

  for (const [table, rows] of steps) {
    try {
      await upsert(table, rows);
      console.log(`✓ ${table} (${rows.length} rows)`);
    } catch (e) {
      console.error(`✗ ${table}: ${e.message}`);
    }
  }

  console.log("\nDone! 9 new packages seeded across Phoenix, Dallas, and Denver.");
}

run();
