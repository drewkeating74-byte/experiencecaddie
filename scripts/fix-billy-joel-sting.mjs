/**
 * One-off cleanup for the "Billy Joel & Sting" (Charlotte, 2026-07-03) event:
 *   1. De-duplicate: the concert exists as 3 rows (3 seed batches). Keep the
 *      one referenced by a package; delete the two orphans (0 package refs).
 *      NOTE: packages.event_id -> events is ON DELETE CASCADE, so we hard-guard
 *      that we only ever delete rows with zero package references.
 *   2. Fix the stale event: source_id "G5eVZb3cBovL6" 404s on Ticketmaster.
 *      Search TM Discovery for the current event, then update the canonical
 *      row's source_id + image_url, and the artist image.
 *
 * DB: PG* env vars. Key: TM_API_KEY / TICKETMASTER_CONSUMER_KEY / TICKETMASTER_API_KEY.
 *
 *   node scripts/fix-billy-joel-sting.mjs --dry-run   # preview, no writes
 *   node scripts/fix-billy-joel-sting.mjs             # apply
 */
import pg from "pg";

const DRY = process.argv.includes("--dry-run");
const TM_KEY =
  process.env.TM_API_KEY ||
  process.env.TICKETMASTER_CONSUMER_KEY ||
  process.env.TICKETMASTER_API_KEY;

const CANONICAL_ID = "e7ed0000-0000-0000-0000-000000000018";
const DUP_IDS = [
  "e5ed0000-0000-0000-0000-000000000009",
  "e6ed0000-0000-0000-0000-000000000010",
];

function pickBestImage(images) {
  if (!Array.isArray(images)) return null;
  const real = images.filter((i) => i && typeof i.url === "string" && i.url);
  if (real.length === 0) return null;
  const pool = real.some((i) => !i.fallback) ? real.filter((i) => !i.fallback) : real;
  const score = (img) => {
    let s = 0;
    if (img.ratio === "16_9") s += 1_000_000;
    if (img.type === "RETINA_LANDSCAPE") s += 20_000;
    else if (img.type === "LANDSCAPE") s += 10_000;
    s += Number(img.width) || 0;
    return s;
  };
  return pool.slice().sort((a, b) => score(b) - score(a))[0].url;
}

async function searchOnce(params) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", TM_KEY);
  url.searchParams.set("size", "30");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TM search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?._embedded?.events ?? [];
}

// Try increasingly broad queries; return the first non-empty result set.
async function searchTm() {
  const attempts = [
    { keyword: "Billy Joel Sting", startDateTime: "2026-07-02T00:00:00Z", endDateTime: "2026-07-05T00:00:00Z" },
    { keyword: "Billy Joel", city: "Charlotte" },
    { keyword: "Billy Joel" },
  ];
  for (const a of attempts) {
    const events = await searchOnce(a);
    console.log(`  search ${JSON.stringify(a)} -> ${events.length} result(s)`);
    if (events.length) return events;
  }
  return [];
}

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
  ssl: { rejectUnauthorized: false },
});

async function run() {
  if (!TM_KEY) throw new Error("Missing Ticketmaster API key env var.");
  await client.connect();

  // Safety guard: confirm the dup rows truly have zero package references.
  const { rows: guard } = await client.query(
    `SELECT e.id, (SELECT count(*) FROM public.packages p WHERE p.event_id = e.id)::int AS refs
       FROM public.events e WHERE e.id = ANY($1);`,
    [DUP_IDS]
  );
  const unsafe = guard.filter((g) => g.refs > 0);
  if (unsafe.length) {
    throw new Error(`Aborting: dup rows have package refs (CASCADE risk): ${JSON.stringify(unsafe)}`);
  }

  // Find the artist on the canonical row.
  const { rows: canonRows } = await client.query(
    `SELECT id, name, source_id, artist_id, image_url FROM public.events WHERE id = $1;`,
    [CANONICAL_ID]
  );
  const canon = canonRows[0];

  // Search TM for the live event. Strict match only: must be in Charlotte AND
  // be the Billy Joel & Sting co-headline (not a solo/tribute show). We do NOT
  // fall back to an arbitrary candidate — injecting a wrong event is worse than
  // leaving the row unfixed.
  const candidates = await searchTm();
  const chosen =
    candidates.find((e) => {
      const city = (e._embedded?.venues?.[0]?.city?.name ?? "").toLowerCase();
      const name = (e.name ?? "").toLowerCase();
      return city.includes("charlotte") && name.includes("billy joel") && name.includes("sting");
    }) ?? null;
  const eventImg = chosen ? pickBestImage(chosen.images) : null;
  const artistImg = chosen ? pickBestImage(chosen._embedded?.attractions?.[0]?.images) : null;

  console.log("Canonical row:", { id: canon.id, source_id: canon.source_id, artist_id: canon.artist_id });
  console.log(`Dup rows to delete (0 refs each): ${DUP_IDS.join(", ")}`);
  console.log("\nTM search candidates:");
  candidates.forEach((e) =>
    console.log(
      `  - ${e.id} | ${e.name} | ${e.dates?.start?.localDate} | ${e._embedded?.venues?.[0]?.city?.name ?? "?"}`
    )
  );
  console.log("\nChosen event :", chosen ? `${chosen.id} (${chosen.dates?.start?.localDate}, ${chosen._embedded?.venues?.[0]?.city?.name})` : "NONE FOUND");
  console.log("New source_id:", chosen?.id ?? "(unchanged)");
  console.log("Event image  :", eventImg ?? "NULL");
  console.log("Artist image :", artistImg ?? "NULL");

  if (DRY) {
    console.log("\n[DRY RUN] No changes written.");
    return;
  }

  await client.query("BEGIN");
  try {
    const del = await client.query(`DELETE FROM public.events WHERE id = ANY($1);`, [DUP_IDS]);
    console.log(`\nDeleted ${del.rowCount} duplicate event row(s).`);

    if (chosen) {
      await client.query(
        `UPDATE public.events
            SET source_id = $1,
                image_url = COALESCE($2, image_url),
                updated_at = now()
          WHERE id = $3;`,
        [chosen.id, eventImg, CANONICAL_ID]
      );
      console.log(`Updated canonical event ${CANONICAL_ID}: source_id=${chosen.id}, image set=${Boolean(eventImg)}`);

      if (artistImg && canon.artist_id) {
        const r = await client.query(
          `UPDATE public.artists SET image_url = COALESCE(image_url, $1), updated_at = now()
            WHERE id = $2;`,
          [artistImg, canon.artist_id]
        );
        console.log(`Artist image update affected ${r.rowCount} row(s).`);
      }
    } else {
      console.log("No TM event found — left source_id/image unchanged.");
    }

    await client.query("COMMIT");
    console.log("Committed transaction.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

run()
  .catch((err) => {
    console.error("FATAL:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
