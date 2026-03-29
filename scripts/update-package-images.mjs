/**
 * Patches all 9 featured packages with 9 unique Unsplash images.
 * Images are chosen to reflect the artist genre and city vibe.
 * Run: node --env-file=.env scripts/update-package-images.mjs
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (never commit these).
 */

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in the environment (e.g. .env at repo root)."
  );
  process.exit(1);
}

async function patchPackage(id, image_url) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/packages?id=eq.${id}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ image_url }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
}

// 9 distinct Unsplash photos — each package gets its own image
// Format: ?w=800&h=500&fit=crop for consistent card aspect ratio
const PACKAGE_IMAGES = [
  // Austin – Country (Luke Combs): warm arena crowd, southern energy
  {
    id: "f1ec0001-0000-0000-0000-000000000001",
    image_url:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=500&fit=crop",
  },
  // Austin – Rock (Green Day): electric crowd, mosh-pit energy
  {
    id: "f1ec0001-0000-0000-0000-000000000002",
    image_url:
      "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=800&h=500&fit=crop",
  },
  // Austin – Pop (Olivia Rodrigo): colorful stage lights, youthful vibe
  {
    id: "f1ec0001-0000-0000-0000-000000000003",
    image_url:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=800&h=500&fit=crop",
  },
  // Nashville – Country (Chris Stapleton): intimate performer, soulful lighting
  {
    id: "f1ec0001-0000-0000-0000-000000000004",
    image_url:
      "https://images.unsplash.com/photo-1508854710579-5cecc3a9ff17?w=800&h=500&fit=crop",
  },
  // Nashville – Rock (Metallica): dramatic aerial stage shot, pyro scale
  {
    id: "f1ec0001-0000-0000-0000-000000000005",
    image_url:
      "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=800&h=500&fit=crop",
  },
  // Nashville – Pop (Taylor Swift): sweeping stage light beams, grand production
  {
    id: "f1ec0001-0000-0000-0000-000000000006",
    image_url:
      "https://images.unsplash.com/photo-1470229538611-16ba8c7ffbd7?w=800&h=500&fit=crop",
  },
  // Las Vegas – Country (Morgan Wallen): neon-lit Vegas night atmosphere
  {
    id: "f1ec0001-0000-0000-0000-000000000007",
    image_url:
      "https://images.unsplash.com/photo-1581351721010-8cf859cb14a4?w=800&h=500&fit=crop",
  },
  // Las Vegas – Rock (Foo Fighters): concert venue with crowd, big-room energy
  {
    id: "f1ec0001-0000-0000-0000-000000000008",
    image_url:
      "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&h=500&fit=crop",
  },
  // Las Vegas – Pop (Billie Eilish): moody performance atmosphere, dramatic lighting
  {
    id: "f1ec0001-0000-0000-0000-000000000009",
    image_url:
      "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=800&h=500&fit=crop",
  },
];

async function run() {
  console.log("Updating package images...\n");
  let ok = 0;
  let fail = 0;

  for (const pkg of PACKAGE_IMAGES) {
    try {
      await patchPackage(pkg.id, pkg.image_url);
      console.log(`✓ ${pkg.id}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${pkg.id} — ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} updated, ${fail} failed`);
}

run();
