#!/usr/bin/env node
/**
 * Seed golf catalog for Phase 1A (Phoenix, Nashville, Austin).
 * Usage:
 *   node scripts/seed-golf-catalog.mjs
 *   node scripts/seed-golf-catalog.mjs --from-search path/to/search-response.json
 */
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
  console.error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const CITY_TO_METRO = {
  phoenix: "Phoenix",
  scottsdale: "Phoenix",
  tempe: "Phoenix",
  mesa: "Phoenix",
  gilbert: "Phoenix",
  nashville: "Nashville",
  franklin: "Nashville",
  brentwood: "Nashville",
  austin: "Austin",
  "round rock": "Austin",
  "cedar park": "Austin",
};

function inferMetro(city, state) {
  if (!city) return null;
  const key = String(city).toLowerCase().trim();
  if (CITY_TO_METRO[key]) return CITY_TO_METRO[key];
  return null;
}

function transformFromSearch(golfCourses) {
  const records = [];
  for (const c of golfCourses || []) {
    if (!c?.id) continue;
    if (c.public_access_confidence === "likely_private") continue;
    const city = c.city || "";
    const state = c.state || "";
    const metro = inferMetro(city, state);
    if (!metro) continue;
    const sourceId = String(c.id).replace(/^places\//, "");
    records.push({
      source_id: sourceId,
      name: c.name || "Golf Course",
      city,
      state,
      metro,
      canonical_name: c.name || "Golf Course",
      lat: c.lat ?? null,
      lng: c.lng ?? null,
      public_access_confidence: c.public_access_confidence || "unknown",
      normalized_quality_score: c.quality_score ?? null,
      tier_hint: c.tier_hint ?? null,
      excluded_reason: null,
      active: true,
    });
  }
  return records;
}

async function upsertCourse(row) {
  const payload = {
    name: row.name,
    city: row.city,
    state: row.state || null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    metro: row.metro,
    canonical_name: row.canonical_name ?? row.name,
    public_access_confidence: row.public_access_confidence ?? "unknown",
    normalized_quality_score: row.normalized_quality_score ?? null,
    tier_hint: row.tier_hint ?? null,
    editorial_boost: row.editorial_boost ?? 0,
    active: row.active !== false,
    excluded_reason: row.excluded_reason ?? null,
    place_id: row.source_id,
    source: "google_places",
    source_id: row.source_id,
    holes: 18,
  };
  const { error } = await supabase
    .from("golf_courses")
    .upsert(payload, {
      onConflict: "source,source_id",
      ignoreDuplicates: false,
    });
  if (error) throw error;
  return { ok: true };
}

async function seed() {
  const fromSearch = process.argv.includes("--from-search");
  const idx = process.argv.indexOf("--from-search");
  const searchPath = idx >= 0 ? process.argv[idx + 1] : null;

  let records = [];

  if (fromSearch && searchPath) {
    const fullPath = path.isAbsolute(searchPath)
      ? searchPath
      : path.resolve(process.cwd(), searchPath);
    if (!fs.existsSync(fullPath)) {
      console.error("File not found:", fullPath);
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const golfCourses = raw.golf_courses ?? raw;
    records = transformFromSearch(Array.isArray(golfCourses) ? golfCourses : []);
    console.log(`Loaded ${records.length} courses from search response`);
  } else {
    const jsonPath = path.join(__dirname, "data", "golf-catalog-phase1a.json");
    if (!fs.existsSync(jsonPath)) {
      console.error("golf-catalog-phase1a.json not found. Create it or use --from-search.");
      process.exit(1);
    }
    const arr = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    records = Array.isArray(arr)
      ? arr.filter((r) => r && r.source_id && typeof r.source_id === "string")
      : [];
  }

  if (records.length === 0) {
    console.log("No records to seed. Add courses to golf-catalog-phase1a.json or use --from-search.");
    return;
  }

  let ok = 0;
  let err = 0;
  for (const row of records) {
    try {
      await upsertCourse(row);
      ok++;
    } catch (e) {
      console.error("Error upserting", row.name, row.source_id, e.message);
      err++;
    }
  }
  console.log(`Seeded ${ok} courses.${err ? ` ${err} errors.` : ""}`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
