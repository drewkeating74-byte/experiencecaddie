/**
 * One-shot seed script: inserts 9 featured packages (3 genres × 3 metros).
 * Run with: node scripts/seed-featured-packages.mjs
 */
const SUPABASE_URL = "https://kxibaydbhquospzoefva.supabase.co";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4aWJheWRiaHF1b3Nwem9lZnZhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjMxNzI3NiwiZXhwIjoyMDg3ODkzMjc2fQ.elMfxybHtpeh0vHHy9P0KmTBowyJLiYkF7WiiIcI9cw";

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal,resolution=ignore-duplicates",
};

async function upsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers,
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${table} insert failed ${res.status}: ${txt}`);
  }
  console.log(`✓ ${table} (${rows.length} rows)`);
}

// ── Destinations ─────────────────────────────────────────────────────────────
await upsert("destinations", [
  { id: "d1ec0001-0000-0000-0000-000000000001", name: "Austin, TX", city: "Austin", state: "TX", country: "US", lat: 30.2672, lng: -97.7431, image_url: "https://images.unsplash.com/photo-1531218150217-54595bc2b934?w=800&fit=crop", description: "Live music capital of the world with world-class public golf" },
  { id: "d1ec0001-0000-0000-0000-000000000002", name: "Nashville, TN", city: "Nashville", state: "TN", country: "US", lat: 36.1627, lng: -86.7816, image_url: "https://images.unsplash.com/photo-1545310143-3b4e5c96d6e9?w=800&fit=crop", description: "Country music capital paired with championship resort courses" },
  { id: "d1ec0001-0000-0000-0000-000000000003", name: "Las Vegas, NV", city: "Las Vegas", state: "NV", country: "US", lat: 36.1699, lng: -115.1398, image_url: "https://images.unsplash.com/photo-1581351721010-8cf859cb14a4?w=800&fit=crop", description: "World-class entertainment and premier desert resort golf" },
]);

// ── Artists ───────────────────────────────────────────────────────────────────
await upsert("artists", [
  { id: "a1ec0001-0000-0000-0000-000000000001", name: "Luke Combs", genre: "Country", subgenre: "Contemporary Country", description: "Multi-platinum country superstar known for sold-out arena tours" },
  { id: "a1ec0001-0000-0000-0000-000000000002", name: "Green Day", genre: "Rock", subgenre: "Punk Rock", description: "Legendary punk rock trio with decades of stadium-filling anthems" },
  { id: "a1ec0001-0000-0000-0000-000000000003", name: "Olivia Rodrigo", genre: "Pop", subgenre: "Pop Rock", description: "Grammy-winning pop sensation with one of the fastest-rising careers in music" },
  { id: "a1ec0001-0000-0000-0000-000000000004", name: "Chris Stapleton", genre: "Country", subgenre: "Outlaw Country", description: "Grammy Award-winning country and blues artist with electrifying live performances" },
  { id: "a1ec0001-0000-0000-0000-000000000005", name: "Metallica", genre: "Rock", subgenre: "Heavy Metal", description: "Iconic heavy metal band delivering legendary arena shows for over four decades" },
  { id: "a1ec0001-0000-0000-0000-000000000006", name: "Taylor Swift", genre: "Pop", subgenre: "Pop", description: "Record-breaking touring artist and the defining pop voice of her generation" },
  { id: "a1ec0001-0000-0000-0000-000000000007", name: "Morgan Wallen", genre: "Country", subgenre: "Country Pop", description: "Record-shattering country artist known for massive stadium and arena shows" },
  { id: "a1ec0001-0000-0000-0000-000000000008", name: "Foo Fighters", genre: "Rock", subgenre: "Alternative Rock", description: "Rock hall legends headlining festivals and arenas worldwide" },
  { id: "a1ec0001-0000-0000-0000-000000000009", name: "Billie Eilish", genre: "Pop", subgenre: "Indie Pop", description: "Grammy-winning pop artist known for intimate-feeling, visually stunning arena spectacles" },
]);

// ── Venues ────────────────────────────────────────────────────────────────────
await upsert("venues", [
  { id: "b1ec0001-0000-0000-0000-000000000001", name: "Moody Center", city: "Austin", state: "TX", country: "US", address: "2501 Pearce Rd, Austin, TX 78712", capacity: 15000, venue_type: "arena", metro: "austin", active: true, lat: 30.2856, lng: -97.7362 },
  { id: "b1ec0001-0000-0000-0000-000000000002", name: "Bridgestone Arena", city: "Nashville", state: "TN", country: "US", address: "501 Broadway, Nashville, TN 37203", capacity: 20000, venue_type: "arena", metro: "nashville", active: true, lat: 36.1592, lng: -86.7785 },
  { id: "b1ec0001-0000-0000-0000-000000000003", name: "Dolby Live at MGM Grand", city: "Las Vegas", state: "NV", country: "US", address: "3799 S Las Vegas Blvd, Las Vegas, NV 89109", capacity: 5200, venue_type: "theater", metro: "las-vegas", active: true, lat: 36.1021, lng: -115.1705 },
]);

// ── Events ────────────────────────────────────────────────────────────────────
await upsert("events", [
  { id: "e1ec0001-0000-0000-0000-000000000001", name: "Luke Combs - Austin, TX", artist_id: "a1ec0001-0000-0000-0000-000000000001", venue_id: "b1ec0001-0000-0000-0000-000000000001", event_date: "2026-06-06", event_time: "20:00:00", timezone: "America/Chicago", ticket_url: "https://www.ticketmaster.com/search?q=Luke+Combs+Austin", min_price: 95, max_price: 350, availability_status: "available" },
  { id: "e1ec0001-0000-0000-0000-000000000002", name: "Green Day - Austin, TX", artist_id: "a1ec0001-0000-0000-0000-000000000002", venue_id: "b1ec0001-0000-0000-0000-000000000001", event_date: "2026-07-11", event_time: "20:00:00", timezone: "America/Chicago", ticket_url: "https://www.ticketmaster.com/search?q=Green+Day+Austin", min_price: 85, max_price: 275, availability_status: "available" },
  { id: "e1ec0001-0000-0000-0000-000000000003", name: "Olivia Rodrigo - Austin, TX", artist_id: "a1ec0001-0000-0000-0000-000000000003", venue_id: "b1ec0001-0000-0000-0000-000000000001", event_date: "2026-08-08", event_time: "20:00:00", timezone: "America/Chicago", ticket_url: "https://www.ticketmaster.com/search?q=Olivia+Rodrigo+Austin", min_price: 110, max_price: 450, availability_status: "available" },
  { id: "e1ec0001-0000-0000-0000-000000000004", name: "Chris Stapleton - Nashville, TN", artist_id: "a1ec0001-0000-0000-0000-000000000004", venue_id: "b1ec0001-0000-0000-0000-000000000002", event_date: "2026-05-30", event_time: "20:00:00", timezone: "America/Chicago", ticket_url: "https://www.ticketmaster.com/search?q=Chris+Stapleton+Nashville", min_price: 125, max_price: 425, availability_status: "available" },
  { id: "e1ec0001-0000-0000-0000-000000000005", name: "Metallica - Nashville, TN", artist_id: "a1ec0001-0000-0000-0000-000000000005", venue_id: "b1ec0001-0000-0000-0000-000000000002", event_date: "2026-07-18", event_time: "20:00:00", timezone: "America/Chicago", ticket_url: "https://www.ticketmaster.com/search?q=Metallica+Nashville", min_price: 100, max_price: 350, availability_status: "available" },
  { id: "e1ec0001-0000-0000-0000-000000000006", name: "Taylor Swift - Nashville, TN", artist_id: "a1ec0001-0000-0000-0000-000000000006", venue_id: "b1ec0001-0000-0000-0000-000000000002", event_date: "2026-08-22", event_time: "19:30:00", timezone: "America/Chicago", ticket_url: "https://www.ticketmaster.com/search?q=Taylor+Swift+Nashville", min_price: 150, max_price: 600, availability_status: "available" },
  { id: "e1ec0001-0000-0000-0000-000000000007", name: "Morgan Wallen - Las Vegas, NV", artist_id: "a1ec0001-0000-0000-0000-000000000007", venue_id: "b1ec0001-0000-0000-0000-000000000003", event_date: "2026-06-13", event_time: "21:00:00", timezone: "America/Los_Angeles", ticket_url: "https://www.ticketmaster.com/search?q=Morgan+Wallen+Las+Vegas", min_price: 90, max_price: 325, availability_status: "available" },
  { id: "e1ec0001-0000-0000-0000-000000000008", name: "Foo Fighters - Las Vegas, NV", artist_id: "a1ec0001-0000-0000-0000-000000000008", venue_id: "b1ec0001-0000-0000-0000-000000000003", event_date: "2026-07-04", event_time: "21:00:00", timezone: "America/Los_Angeles", ticket_url: "https://www.ticketmaster.com/search?q=Foo+Fighters+Las+Vegas", min_price: 80, max_price: 260, availability_status: "available" },
  { id: "e1ec0001-0000-0000-0000-000000000009", name: "Billie Eilish - Las Vegas, NV", artist_id: "a1ec0001-0000-0000-0000-000000000009", venue_id: "b1ec0001-0000-0000-0000-000000000003", event_date: "2026-08-29", event_time: "21:00:00", timezone: "America/Los_Angeles", ticket_url: "https://www.ticketmaster.com/search?q=Billie+Eilish+Las+Vegas", min_price: 120, max_price: 480, availability_status: "available" },
]);

// ── Packages ──────────────────────────────────────────────────────────────────
// golf_course_id values are real catalog UUIDs loaded by refresh-catalog:
//   Austin:    b099b173-2fda-4b79-b196-9f835d85d88c  (The Golf Club at Star Ranch)
//   Nashville: fda2c5d9-a87b-4dab-8347-aaddee64a187  (Gaylord Springs Golf Links)
//   Las Vegas: 74fd4b12-c14d-4cb4-b7d7-89504acadf62  (Las Vegas Paiute Golf Resort)
await upsert("packages", [
  { id: "f1ec0001-0000-0000-0000-000000000001", name: "Luke Combs + Golf – Austin Weekend", event_id: "e1ec0001-0000-0000-0000-000000000001", golf_course_id: "b099b173-2fda-4b79-b196-9f835d85d88c", destination_id: "d1ec0001-0000-0000-0000-000000000001", description: "Country music and championship golf in the Live Music Capital. Catch Luke Combs at Moody Center, then hit the fairways at Star Ranch Golf Club.", image_url: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&fit=crop", price: 895, original_price: 1050, category: "Golf + Concert", featured: true, active: true },
  { id: "f1ec0001-0000-0000-0000-000000000002", name: "Green Day + Golf – Austin Weekend", event_id: "e1ec0001-0000-0000-0000-000000000002", golf_course_id: "b099b173-2fda-4b79-b196-9f835d85d88c", destination_id: "d1ec0001-0000-0000-0000-000000000001", description: "Punk rock anthems and morning tee times in Austin. Green Day at Moody Center paired with a round at one of Austin's top public courses.", image_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&fit=crop", price: 875, original_price: 995, category: "Golf + Concert", featured: true, active: true },
  { id: "f1ec0001-0000-0000-0000-000000000003", name: "Olivia Rodrigo + Golf – Austin Weekend", event_id: "e1ec0001-0000-0000-0000-000000000003", golf_course_id: "b099b173-2fda-4b79-b196-9f835d85d88c", destination_id: "d1ec0001-0000-0000-0000-000000000001", description: "A pop-perfect Austin weekend — Olivia Rodrigo lighting up Moody Center, with a scenic round at Star Ranch Golf Club the next morning.", image_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&fit=crop", price: 925, original_price: 1095, category: "Golf + Concert", featured: true, active: true },
  { id: "f1ec0001-0000-0000-0000-000000000004", name: "Chris Stapleton + Golf – Nashville Weekend", event_id: "e1ec0001-0000-0000-0000-000000000004", golf_course_id: "fda2c5d9-a87b-4dab-8347-aaddee64a187", destination_id: "d1ec0001-0000-0000-0000-000000000002", description: "World-class country music meets championship golf in Music City. Chris Stapleton at Bridgestone Arena, then a round at Gaylord Springs Golf Links.", image_url: "https://images.unsplash.com/photo-1508854710579-5cecc3a9ff17?w=800&fit=crop", price: 975, original_price: 1150, category: "Golf + Concert", featured: true, active: true },
  { id: "f1ec0001-0000-0000-0000-000000000005", name: "Metallica + Golf – Nashville Weekend", event_id: "e1ec0001-0000-0000-0000-000000000005", golf_course_id: "fda2c5d9-a87b-4dab-8347-aaddee64a187", destination_id: "d1ec0001-0000-0000-0000-000000000002", description: "Heavy metal and southern fairways — Metallica at Bridgestone Arena, then a sunrise round at Gaylord Springs Golf Links.", image_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&fit=crop", price: 950, original_price: 1095, category: "Golf + Concert", featured: true, active: true },
  { id: "f1ec0001-0000-0000-0000-000000000006", name: "Taylor Swift + Golf – Nashville Weekend", event_id: "e1ec0001-0000-0000-0000-000000000006", golf_course_id: "fda2c5d9-a87b-4dab-8347-aaddee64a187", destination_id: "d1ec0001-0000-0000-0000-000000000002", description: "The ultimate Nashville experience — Taylor Swift at the arena where she got her start, plus championship golf at Gaylord Springs Golf Links.", image_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&fit=crop", price: 1095, original_price: 1295, category: "Golf + Concert", featured: true, active: true },
  { id: "f1ec0001-0000-0000-0000-000000000007", name: "Morgan Wallen + Golf – Las Vegas Weekend", event_id: "e1ec0001-0000-0000-0000-000000000007", golf_course_id: "74fd4b12-c14d-4cb4-b7d7-89504acadf62", destination_id: "d1ec0001-0000-0000-0000-000000000003", description: "Country meets the desert in Las Vegas — Morgan Wallen at Dolby Live, plus a premier round at Las Vegas Paiute Golf Resort.", image_url: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&fit=crop", price: 1195, original_price: 1395, category: "Golf + Concert", featured: true, active: true },
  { id: "f1ec0001-0000-0000-0000-000000000008", name: "Foo Fighters + Golf – Las Vegas Weekend", event_id: "e1ec0001-0000-0000-0000-000000000008", golf_course_id: "74fd4b12-c14d-4cb4-b7d7-89504acadf62", destination_id: "d1ec0001-0000-0000-0000-000000000003", description: "Rock out under the Vegas lights — Foo Fighters at Dolby Live, followed by a sunrise round at Las Vegas Paiute Golf Resort.", image_url: "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&fit=crop", price: 1150, original_price: 1350, category: "Golf + Concert", featured: true, active: true },
  { id: "f1ec0001-0000-0000-0000-000000000009", name: "Billie Eilish + Golf – Las Vegas Weekend", event_id: "e1ec0001-0000-0000-0000-000000000009", golf_course_id: "74fd4b12-c14d-4cb4-b7d7-89504acadf62", destination_id: "d1ec0001-0000-0000-0000-000000000003", description: "An unforgettable Vegas weekend — Billie Eilish at Dolby Live, plus a round at Las Vegas Paiute Golf Resort as the sun rises over the Mojave.", image_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&fit=crop", price: 1295, original_price: 1550, category: "Golf + Concert", featured: true, active: true },
]);

// ── Verify ────────────────────────────────────────────────────────────────────
const check = await fetch(
  `${SUPABASE_URL}/rest/v1/packages?featured=eq.true&active=eq.true&select=name,price`,
  { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
);
const pkgs = await check.json();
console.log(`\n✓ Live featured packages: ${pkgs.length}`);
pkgs.forEach((p) => console.log(`  - ${p.name} ($${p.price})`));
