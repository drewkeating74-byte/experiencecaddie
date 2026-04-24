/**
 * verify-packages — Periodic Ticketmaster verification for active catalog packages.
 *
 * For each active package with artist + city + event date:
 *   - Resolves the show via Ticketmaster (same logic as itinerary generation).
 *   - Same calendar date + match → mark ok; refresh events.ticket_url when TM has a direct event URL.
 *   - No match or wrong date → deactivate package (and unfeature) so browse pages stay honest.
 *
 * Auth: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Query:
 *   ?suggest=1 — include metro_gaps (catalog metros with zero active curated packages).
 *   ?dry_run=1 — report only; no DB writes (use before a real run).
 *   ?strict_direct_tm=1 — require a direct Ticketmaster event URL from resolution (not Google fallback).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { METROS, getMetroByCity } from "../_shared/golfCities.ts";
import { resolveConcertFromTicketmaster } from "../_shared/ticketmaster.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function addCalendarDaysYmd(ymd: string, delta: number): string {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function toYmd(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** True if at least one significant token overlaps (catches wrong venue on same night). */
function venuesRoughlyMatch(catalogVenue: string, ticketmasterVenue: string): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const a = words(catalogVenue);
  const b = words(ticketmasterVenue);
  if (a.length === 0 || b.length === 0) return true;
  const bset = new Set(b);
  return a.some((w) => bset.has(w));
}

async function updatePackage(
  sb: ReturnType<typeof createClient>,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await sb.from("packages").update(patch).eq("id", id);
  if (!error) return;
  const msg = error.message || "";
  const maybeMissingAudit =
    msg.includes("last_ticketmaster_check_at") ||
    msg.includes("ticketmaster_last_ok") ||
    (msg.includes("column") && msg.includes("does not exist"));
  if (maybeMissingAudit) {
    const minimal: Record<string, unknown> = {};
    if ("active" in patch) minimal.active = patch.active;
    if ("featured" in patch) minimal.featured = patch.featured;
    if (Object.keys(minimal).length === 0) {
      console.warn(`[verify-packages] audit columns missing; skipped audit-only write for ${id}`);
      return;
    }
    const { error: e2 } = await sb.from("packages").update(minimal).eq("id", id);
    if (e2) throw new Error(e2.message);
    console.warn(
      `[verify-packages] partial update (run migration 20260418120000 for ticketmaster_last_ok / last_ticketmaster_check_at): ${id}`
    );
    return;
  }
  throw new Error(msg);
}

type EventEmbed = {
  id: string;
  event_date: string;
  ticket_url: string | null;
  artists: { name: string } | null;
  venues: { name: string; city: string | null; state: string | null } | null;
} | null;

type PackageRow = {
  id: string;
  name: string;
  source: string;
  featured: boolean | null;
  event_id: string | null;
  event_date: string | null;
  artist_name: string | null;
  city: string | null;
  events: EventEmbed | EventEmbed[] | null;
  destinations: { city: string | null; state: string | null } | null;
};

function embedEvent(row: PackageRow): EventEmbed {
  const e = row.events;
  if (e == null) return null;
  return Array.isArray(e) ? e[0] ?? null : e;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const hasTmKey = Boolean(
    Deno.env.get("TICKETMASTER_API_KEY") || Deno.env.get("TICKETMASTER_CONSUMER_KEY")
  );
  if (!hasTmKey) {
    return json({ error: "TICKETMASTER_API_KEY not configured — cannot verify packages" }, 503);
  }

  const url = new URL(req.url);
  const suggest = url.searchParams.get("suggest") === "1";
  const dryRun = url.searchParams.get("dry_run") === "1";
  const strictDirectTm = url.searchParams.get("strict_direct_tm") === "1";

  const sb = createClient(supabaseUrl, serviceKey);

  const { data: rows, error: qErr } = await sb
    .from("packages")
    .select(
      `
      id, name, source, featured, event_id, event_date, artist_name, city,
      events ( id, event_date, ticket_url, artists ( name ), venues ( name, city, state ) ),
      destinations ( city, state )
    `
    )
    .eq("active", true);

  if (qErr) {
    console.error("[verify-packages] query error:", qErr.message);
    return json({ error: qErr.message }, 500);
  }

  const result = {
    dry_run: dryRun,
    strict_direct_tm: strictDirectTm,
    checked: 0,
    verified_ok: 0,
    deactivated: 0,
    skipped_incomplete: 0,
    ticket_url_refreshed: 0,
    details: [] as Array<{
      package_id: string;
      name: string;
      outcome: "ok" | "deactivated" | "skipped";
      reason?: string;
      ticketmaster_venue?: string;
    }>,
  };

  const today = new Date().toISOString().slice(0, 10);

  for (const raw of rows ?? []) {
    const row = raw as unknown as PackageRow;
    const ev = embedEvent(row);
    const artist = ev?.artists?.name?.trim() || row.artist_name?.trim() || "";
    const city =
      ev?.venues?.city?.trim() ||
      row.destinations?.city?.trim() ||
      row.city?.trim() ||
      "";
    const eventYmd = toYmd(ev?.event_date) || toYmd(row.event_date);

    if (!artist || !city || !eventYmd) {
      result.skipped_incomplete++;
      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "skipped",
        reason: "missing artist, city, or event date",
      });
      continue;
    }

    if (eventYmd < today) {
      result.deactivated++;
      if (!dryRun) {
        await updatePackage(sb, row.id, {
          active: false,
          featured: false,
          last_ticketmaster_check_at: new Date().toISOString(),
          ticketmaster_last_ok: false,
        });
      }
      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "deactivated",
        reason: "event date in the past",
      });
      continue;
    }

    const winStart = addCalendarDaysYmd(eventYmd, -90);
    const winEnd = addCalendarDaysYmd(eventYmd, 90);

    let resolved: Awaited<ReturnType<typeof resolveConcertFromTicketmaster>> = null;
    try {
      resolved = await resolveConcertFromTicketmaster({
        artist,
        city,
        startDate: winStart,
        endDate: winEnd,
        dateHintYmd: eventYmd,
      });
    } catch (e) {
      console.error(`[verify-packages] TM error for ${row.id}:`, e);
      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "skipped",
        reason: `ticketmaster error: ${e instanceof Error ? e.message : String(e)}`,
      });
      continue;
    }

    result.checked++;
    const resolvedYmd = resolved ? resolved.date_time.slice(0, 10) : null;
    let ok = Boolean(resolved && resolvedYmd === eventYmd);
    let blockReason: string | undefined;

    if (ok && resolved) {
      const pkgVenue = ev?.venues?.name?.trim() ?? "";
      const tmVenue = resolved.venue?.name?.trim() ?? "";
      if (pkgVenue.length > 3 && tmVenue.length > 3 && !venuesRoughlyMatch(pkgVenue, tmVenue)) {
        ok = false;
        blockReason = `venue mismatch: catalog "${pkgVenue}" vs Ticketmaster "${tmVenue}"`;
      }
    }
    if (ok && resolved && strictDirectTm && resolved.book_link?.link_type !== "direct_event") {
      ok = false;
      blockReason = blockReason ?? "no direct Ticketmaster event URL (strict_direct_tm)";
    }

    if (ok && resolved) {
      result.verified_ok++;
      if (!dryRun) {
        await updatePackage(sb, row.id, {
          last_ticketmaster_check_at: new Date().toISOString(),
          ticketmaster_last_ok: true,
        });

        const evId = ev?.id ?? row.event_id;
        const linkType = resolved.book_link?.link_type;
        const newUrl = resolved.book_url?.trim();
        if (evId && linkType === "direct_event" && newUrl && newUrl.startsWith("https://")) {
          const old = ev?.ticket_url ?? "";
          if (old !== newUrl) {
            await sb
              .from("events")
              .update({ ticket_url: newUrl, updated_at: new Date().toISOString() })
              .eq("id", evId);
            result.ticket_url_refreshed++;
          }
        }
      }

      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "ok",
        ticketmaster_venue: resolved.venue?.name,
      });
    } else {
      result.deactivated++;
      if (!dryRun) {
        await updatePackage(sb, row.id, {
          active: false,
          featured: false,
          last_ticketmaster_check_at: new Date().toISOString(),
          ticketmaster_last_ok: false,
        });
      }

      const reason =
        blockReason ??
        (resolved == null
          ? "no matching Ticketmaster event in window"
          : `Ticketmaster date ${resolvedYmd} !== package ${eventYmd}`);
      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "deactivated",
        reason,
        ...(resolved?.venue?.name ? { ticketmaster_venue: resolved.venue.name } : {}),
      });
      console.log(`[verify-packages] ${dryRun ? "[dry_run] would deactivate" : "deactivated"} ${row.id} — ${reason}`);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  let metro_gaps: Array<{ slug: string; label: string }> | undefined;
  if (suggest) {
    const { data: activeCurated } = await sb
      .from("packages")
      .select("city, destinations ( city )")
      .eq("active", true)
      .eq("source", "curated");

    const counts = new Map<string, number>();
    for (const m of METROS) counts.set(m.slug, 0);
    for (const p of activeCurated ?? []) {
      const c =
        (p as { destinations?: { city?: string }; city?: string }).destinations?.city ||
        (p as { city?: string }).city ||
        "";
      const metro = getMetroByCity(c);
      if (metro) counts.set(metro.slug, (counts.get(metro.slug) ?? 0) + 1);
    }
    metro_gaps = METROS.filter((m) => (counts.get(m.slug) ?? 0) === 0).map((m) => ({
      slug: m.slug,
      label: m.label,
    }));
  }

  console.log(
    `[verify-packages] done dry_run=${dryRun} checked=${result.checked} ok=${result.verified_ok} deactivated=${result.deactivated} skipped=${result.skipped_incomplete} urls=${result.ticket_url_refreshed}`
  );

  return json({ ...result, ...(suggest ? { metro_gaps } : {}) });
});
