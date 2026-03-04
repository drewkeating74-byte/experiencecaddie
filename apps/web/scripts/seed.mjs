import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return;
    const [key, ...rest] = trimmed.split("=");
    if (!key) return;
    const value = rest.join("=").replace(/^"|"$/g, "").trim();
    if (!(key in process.env)) process.env[key] = value;
  });
};

loadEnvFile(path.join(projectRoot, ".env"));
loadEnvFile(path.join(__dirname, "../.env"));

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing env vars: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const addDays = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
};

const getByName = async (table, field, value) => {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(field, value)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

const insertIfMissing = async (table, field, value, payload) => {
  const existing = await getByName(table, field, value);
  if (existing) return existing;
  const { data, error } = await supabase.from(table).insert(payload).select("*").single();
  if (error) throw error;
  return data;
};

const seed = async () => {
  console.log("Seeding data...");

  const destinations = [
    {
      name: "Austin Weekend",
      city: "Austin",
      state: "TX",
      country: "United States",
      description: "Live music + premium golf in the Texas capital.",
      lat: 30.2672,
      lng: -97.7431,
    },
    {
      name: "Nashville Weekend",
      city: "Nashville",
      state: "TN",
      country: "United States",
      description: "Broadway nights and great public courses.",
      lat: 36.1627,
      lng: -86.7816,
    },
    {
      name: "Scottsdale Weekend",
      city: "Scottsdale",
      state: "AZ",
      country: "United States",
      description: "Desert golf and arena shows in the Valley of the Sun.",
      lat: 33.4942,
      lng: -111.9261,
    },
  ];

  const destinationRecords = [];
  for (const d of destinations) {
    const record = await insertIfMissing("destinations", "name", d.name, d);
    destinationRecords.push(record);
  }

  const artists = [
    { name: "Zach Bryan", genre: "Country", subgenre: "Americana", image_url: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800" },
    { name: "Foo Fighters", genre: "Rock", subgenre: "Alternative", image_url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800" },
    { name: "Post Malone", genre: "Hip-Hop", subgenre: "Pop", image_url: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800" },
  ];

  const artistRecords = [];
  for (const a of artists) {
    const record = await insertIfMissing("artists", "name", a.name, a);
    artistRecords.push(record);
  }

  const venues = [
    {
      name: "Moody Center",
      city: "Austin",
      state: "TX",
      country: "United States",
      address: "2001 Robert Dedman Dr, Austin, TX",
      capacity: 15000,
      destination_id: destinationRecords[0]?.id,
    },
    {
      name: "Bridgestone Arena",
      city: "Nashville",
      state: "TN",
      country: "United States",
      address: "501 Broadway, Nashville, TN",
      capacity: 20000,
      destination_id: destinationRecords[1]?.id,
    },
    {
      name: "Footprint Center",
      city: "Phoenix",
      state: "AZ",
      country: "United States",
      address: "201 E Jefferson St, Phoenix, AZ",
      capacity: 18000,
      destination_id: destinationRecords[2]?.id,
    },
  ];

  const venueRecords = [];
  for (const v of venues) {
    const record = await insertIfMissing("venues", "name", v.name, v);
    venueRecords.push(record);
  }

  const events = [
    {
      name: "Zach Bryan Live",
      artist_id: artistRecords[0]?.id,
      venue_id: venueRecords[0]?.id,
      event_date: addDays(21),
      event_time: "20:00",
      ticket_url: "https://www.ticketmaster.com",
      min_price: 65,
      max_price: 250,
      source_name: "seed",
      image_url: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800",
    },
    {
      name: "Foo Fighters Tour",
      artist_id: artistRecords[1]?.id,
      venue_id: venueRecords[1]?.id,
      event_date: addDays(35),
      event_time: "19:30",
      ticket_url: "https://www.ticketmaster.com",
      min_price: 75,
      max_price: 275,
      source_name: "seed",
      image_url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800",
    },
    {
      name: "Post Malone: F-1 Trillion Tour",
      artist_id: artistRecords[2]?.id,
      venue_id: venueRecords[2]?.id,
      event_date: addDays(42),
      event_time: "20:00",
      ticket_url: "https://www.ticketmaster.com",
      min_price: 89,
      max_price: 350,
      source_name: "seed",
      image_url: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800",
    },
  ];

  const eventRecords = [];
  for (const e of events) {
    const record = await insertIfMissing("events", "name", e.name, e);
    eventRecords.push(record);
  }

  const courses = [
    {
      name: "Omni Barton Creek - Fazio Canyons",
      city: "Austin",
      state: "TX",
      country: "United States",
      address: "8212 Barton Club Dr, Austin, TX",
      destination_id: destinationRecords[0]?.id,
      holes: 18,
      public_access: true,
      rating: 4.6,
      green_fee_min: 120,
      green_fee_max: 210,
      booking_url: "https://www.golfnow.com",
      description: "Hill Country layout with dramatic elevation changes.",
      image_url: "https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=800",
    },
    {
      name: "Gaylord Springs Golf Links",
      city: "Nashville",
      state: "TN",
      country: "United States",
      address: "18 Springhouse Ln, Nashville, TN",
      destination_id: destinationRecords[1]?.id,
      holes: 18,
      public_access: true,
      rating: 4.4,
      green_fee_min: 95,
      green_fee_max: 180,
      booking_url: "https://www.golfnow.com",
      description: "Scenic, top-ranked public course outside downtown.",
      image_url: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=800",
    },
    {
      name: "TPC Scottsdale - Stadium Course",
      city: "Scottsdale",
      state: "AZ",
      country: "United States",
      address: "17020 N Hayden Rd, Scottsdale, AZ",
      destination_id: destinationRecords[2]?.id,
      holes: 18,
      public_access: true,
      rating: 4.8,
      green_fee_min: 289,
      green_fee_max: 425,
      booking_url: "https://www.golfnow.com",
      description: "Home of the Waste Management Phoenix Open. Iconic 16th hole.",
      image_url: "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=800",
    },
  ];

  const courseRecords = [];
  for (const c of courses) {
    const record = await insertIfMissing("golf_courses", "name", c.name, c);
    courseRecords.push(record);
  }

  const packages = [
    {
      name: "Austin Live + Links",
      event_id: eventRecords[0]?.id,
      golf_course_id: courseRecords[0]?.id,
      destination_id: destinationRecords[0]?.id,
      price: 699,
      original_price: 849,
      category: "weekend",
      featured: true,
      description: "Big show, great course, and a classic Austin weekend.",
      image_url: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800",
    },
    {
      name: "Nashville Weekend Classic",
      event_id: eventRecords[1]?.id,
      golf_course_id: courseRecords[1]?.id,
      destination_id: destinationRecords[1]?.id,
      price: 649,
      original_price: 799,
      category: "weekend",
      featured: true,
      description: "Broadway nights with a top public golf day.",
      image_url: "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800",
    },
    {
      name: "Scottsdale Desert Vibes",
      event_id: eventRecords[2]?.id,
      golf_course_id: courseRecords[2]?.id,
      destination_id: destinationRecords[2]?.id,
      price: 899,
      original_price: 1099,
      category: "weekend",
      featured: true,
      description: "TPC Scottsdale plus a massive arena show. Desert golf meets hip-hop.",
      image_url: "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=800",
    },
  ];

  for (const p of packages) {
    const existing = await getByName("packages", "name", p.name);
    if (existing) {
      await supabase.from("packages").update({
        image_url: p.image_url,
        featured: p.featured,
        description: p.description,
        price: p.price,
        original_price: p.original_price,
        event_id: p.event_id,
        golf_course_id: p.golf_course_id,
        destination_id: p.destination_id,
      }).eq("id", existing.id);
    } else {
      await supabase.from("packages").insert(p);
    }
  }

  console.log("Seed complete.");
};

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
