/**
 * verify-packages — Periodic concert verification for catalog packages.
 *
 * For each active package with artist + city + event date:
 *   - Verify the show on the exact catalog date via Ticketmaster first.
 *   - If Ticketmaster cannot confirm it, ask Perplexity for sourced web confirmation.
 *   - First failed verification day → keep live, mark Needs Review.
 *   - Second failed verification day → hide from public and mark Failed Verification.
 *   - Past/expired packages are hidden immediately.
 *
 * Auth: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Query:
 *   ?suggest=1 — include metro_gaps (catalog metros with zero active curated packages).
 *   ?dry_run=1 — report only; no DB writes (use before a real run).
 *   ?recover=1 — include inactive future packages and reactivate only if verified.
 *   ?strict_direct_tm=1 — require a direct Ticketmaster event URL from Ticketmaster resolution.
 *   ?require_venue_match=1 — also require catalog venue name to overlap TM venue tokens (stricter; off by default).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { METROS, getMetroByCity } from "../_shared/golfCities.ts";
import {
  buildGoogleTicketsSearchUrl,
  parseFlexibleDateToYmd,
  resolveConcertFromTicketmaster,
} from "../_shared/ticketmaster.ts";

const FAILURE_THRESHOLD = 2;
const PERPLEXITY_MODEL = "sonar-pro";

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

function extractJson(raw: string): string {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  if (!cleaned.startsWith("{")) {
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (s !== -1 && e > s) cleaned = cleaned.slice(s, e + 1);
  }
  return cleaned;
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
    msg.includes("verification_status") ||
    msg.includes("verification_fail_count") ||
    msg.includes("last_verification_at") ||
    msg.includes("last_verification_failed_at") ||
    msg.includes("last_verification_source") ||
    msg.includes("verification_notes") ||
    msg.includes("verification_evidence_url") ||
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
      `[verify-packages] partial update (run package verification migrations before full audit writes): ${id}`
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
  active: boolean | null;
  source: string;
  featured: boolean | null;
  event_id: string | null;
  event_date: string | null;
  artist_name: string | null;
  city: string | null;
  expires_at: string | null;
  verification_fail_count: number | null;
  last_verification_failed_at: string | null;
  events: EventEmbed | EventEmbed[] | null;
  destinations: { city: string | null; state: string | null } | null;
};

function embedEvent(row: PackageRow): EventEmbed {
  const e = row.events;
  if (e == null) return null;
  return Array.isArray(e) ? e[0] ?? null : e;
}

type ProviderSuccess = {
  source: "ticketmaster" | "perplexity";
  dateYmd: string;
  venue?: string;
  url?: string;
  ticketmaster?: Awaited<ReturnType<typeof resolveConcertFromTicketmaster>>;
};

type ProviderFailure = {
  reason: string;
  providerError?: boolean;
  ticketmasterVenue?: string;
};

function sameCalendarDay(a: string | null | undefined, bYmd: string): boolean {
  return toYmd(a) === bYmd;
}

function dateIsExpired(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return !Number.isNaN(t) && t <= nowMs;
}

function nextFailureCount(row: PackageRow, today: string): number {
  const current = Math.max(0, row.verification_fail_count ?? 0);
  return sameCalendarDay(row.last_verification_failed_at, today) ? current : current + 1;
}

async function verifyWithPerplexity(params: {
  apiKey: string;
  artist: string;
  city: string;
  eventYmd: string;
  venue?: string;
}): Promise<ProviderSuccess | null> {
  const venueLine = params.venue?.trim()
    ? `Expected venue if available: ${params.venue.trim()}`
    : "Venue may be omitted if the source does not name one.";
  const prompt = `Confirm whether this concert is happening on the exact requested date.

Artist/event: ${params.artist}
City/market: ${params.city}
Requested date: ${params.eventYmd}
${venueLine}

Return ONLY valid JSON. No markdown, no extra text.
If confirmed by a reliable source: {"confirmed":true,"date":"YYYY-MM-DD","venue":"exact venue name or Venue TBD","url":"source URL","evidence":"short source summary"}
If not confirmed on that exact date: {"confirmed":false,"evidence":"short reason"}

Rules:
- confirmed=true only when the same artist/event is happening in that city/market on the requested date.
- Do not guess or infer dates.
- A different date means confirmed=false.`;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: "system", content: "Concert verification assistant. Return only valid JSON and never guess dates." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 256,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = String(data.choices?.[0]?.message?.content ?? "");
  const parsed = JSON.parse(extractJson(raw)) as {
    confirmed?: boolean;
    date?: string;
    venue?: string;
    url?: string;
  };

  if (!parsed.confirmed) return null;
  const ymd = parseFlexibleDateToYmd(parsed.date ?? "");
  if (ymd !== params.eventYmd) return null;

  const sourceUrl =
    typeof parsed.url === "string" && parsed.url.trim().startsWith("https://")
      ? parsed.url.trim()
      : buildGoogleTicketsSearchUrl({
          performer: params.artist,
          city: params.city,
          venue: typeof parsed.venue === "string" ? parsed.venue : undefined,
          dateYmd: params.eventYmd,
        });

  return {
    source: "perplexity",
    dateYmd: ymd,
    venue: typeof parsed.venue === "string" ? parsed.venue.trim() : undefined,
    url: sourceUrl,
  };
}

async function verifyPackageConcert(params: {
  artist: string;
  city: string;
  eventYmd: string;
  packageVenue?: string;
  strictDirectTm: boolean;
  requireVenueMatch: boolean;
  perplexityKey: string | null;
}): Promise<{ success: ProviderSuccess | null; failure?: ProviderFailure }> {
  const winStart = addCalendarDaysYmd(params.eventYmd, -90);
  const winEnd = addCalendarDaysYmd(params.eventYmd, 90);

  let resolved: Awaited<ReturnType<typeof resolveConcertFromTicketmaster>> = null;
  try {
    resolved = await resolveConcertFromTicketmaster({
      artist: params.artist,
      city: params.city,
      startDate: winStart,
      endDate: winEnd,
      dateHintYmd: params.eventYmd,
    });
  } catch (e) {
    console.error("[verify-packages] Ticketmaster error:", e);
  }

  const resolvedYmd = resolved ? resolved.date_time.slice(0, 10) : null;
  let tmReason =
    resolved == null
      ? "no matching Ticketmaster event in window"
      : `Ticketmaster date ${resolvedYmd} !== package ${params.eventYmd}`;
  let tmOk = Boolean(resolved && resolvedYmd === params.eventYmd);

  if (params.requireVenueMatch && tmOk && resolved) {
    const tmVenue = resolved.venue?.name?.trim() ?? "";
    const pkgVenue = params.packageVenue?.trim() ?? "";
    if (pkgVenue.length > 3 && tmVenue.length > 3 && !venuesRoughlyMatch(pkgVenue, tmVenue)) {
      tmOk = false;
      tmReason = `venue mismatch: catalog "${pkgVenue}" vs Ticketmaster "${tmVenue}"`;
    }
  }
  if (tmOk && resolved && params.strictDirectTm && resolved.book_link?.link_type !== "direct_event") {
    tmOk = false;
    tmReason = "no direct Ticketmaster event URL (strict_direct_tm)";
  }

  if (tmOk && resolved) {
    return {
      success: {
        source: "ticketmaster",
        dateYmd: params.eventYmd,
        venue: resolved.venue?.name,
        url: resolved.book_url,
        ticketmaster: resolved,
      },
    };
  }

  if (!params.perplexityKey) {
    return {
      success: null,
      failure: {
        reason: `${tmReason}; Perplexity not configured`,
        providerError: true,
        ticketmasterVenue: resolved?.venue?.name,
      },
    };
  }

  try {
    const p = await verifyWithPerplexity({
      apiKey: params.perplexityKey,
      artist: params.artist,
      city: params.city,
      eventYmd: params.eventYmd,
      venue: params.packageVenue,
    });
    if (p) return { success: p };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: null,
      failure: {
        reason: `${tmReason}; Perplexity error: ${msg}`,
        providerError: true,
        ticketmasterVenue: resolved?.venue?.name,
      },
    };
  }

  return {
    success: null,
    failure: {
      reason: `${tmReason}; Perplexity did not confirm exact date`,
      ticketmasterVenue: resolved?.venue?.name,
    },
  };
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
  const hasPerplexityKey = Boolean(Deno.env.get("PERPLEXITY_API_KEY"));
  if (!hasTmKey && !hasPerplexityKey) {
    return json({ error: "No concert verification provider configured" }, 503);
  }

  const url = new URL(req.url);
  const suggest = url.searchParams.get("suggest") === "1";
  const dryRun = url.searchParams.get("dry_run") === "1";
  const recover = url.searchParams.get("recover") === "1";
  const strictDirectTm = url.searchParams.get("strict_direct_tm") === "1";
  const requireVenueMatch = url.searchParams.get("require_venue_match") === "1";
  const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY");

  const sb = createClient(supabaseUrl, serviceKey);

  const baseSelect = `
    id, name, active, source, featured, event_id, event_date, artist_name, city, expires_at,
    events ( id, event_date, ticket_url, artists ( name ), venues ( name, city, state ) ),
    destinations ( city, state )
  `;
  const fullSelect = `
    id, name, active, source, featured, event_id, event_date, artist_name, city, expires_at,
    verification_fail_count, last_verification_failed_at,
    events ( id, event_date, ticket_url, artists ( name ), venues ( name, city, state ) ),
    destinations ( city, state )
  `;
  const runPackageQuery = async (selectClause: string) => {
    let query = sb.from("packages").select(selectClause);
    if (!recover) query = query.eq("active", true);
    return await query;
  };

  let { data: rows, error: qErr } = await runPackageQuery(fullSelect);
  if (qErr) {
    const msg = qErr.message || "";
    const missingVerificationColumns =
      msg.includes("verification_fail_count") ||
      msg.includes("last_verification_failed_at") ||
      (msg.includes("column") && msg.includes("does not exist"));
    if (missingVerificationColumns) {
      console.warn("[verify-packages] verification columns missing; retrying with legacy package shape");
      const retry = await runPackageQuery(baseSelect);
      rows = retry.data;
      qErr = retry.error;
    }
  }

  if (qErr) {
    console.error("[verify-packages] query error:", qErr.message);
    return json({ error: qErr.message }, 500);
  }

  const result = {
    dry_run: dryRun,
    recover,
    strict_direct_tm: strictDirectTm,
    require_venue_match: requireVenueMatch,
    checked: 0,
    verified_ticketmaster: 0,
    verified_perplexity: 0,
    first_failed: 0,
    second_failed_hidden: 0,
    expired_hidden: 0,
    recovered: 0,
    deactivated: 0,
    skipped_incomplete: 0,
    provider_errors: 0,
    ticket_url_refreshed: 0,
    details: [] as Array<{
      package_id: string;
      name: string;
      outcome: "verified" | "needs_review" | "hidden" | "expired" | "skipped";
      reason?: string;
      source?: "ticketmaster" | "perplexity";
      fail_count?: number;
      ticketmaster_venue?: string;
    }>,
  };

  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

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

    if (eventYmd < today || dateIsExpired(row.expires_at, nowMs)) {
      result.deactivated++;
      result.expired_hidden++;
      const reason = eventYmd < today ? "event date in the past" : "package expiry in the past";
      if (!dryRun) {
        await updatePackage(sb, row.id, {
          active: false,
          featured: false,
          verification_status: "expired",
          last_verification_at: nowIso,
          last_verification_source: "system",
          verification_notes: reason,
          last_ticketmaster_check_at: nowIso,
          ticketmaster_last_ok: false,
        });
      }
      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "expired",
        reason,
      });
      continue;
    }

    result.checked++;

    const verification = await verifyPackageConcert({
      artist,
      city,
      eventYmd,
      packageVenue: ev?.venues?.name ?? undefined,
      strictDirectTm,
      requireVenueMatch,
      perplexityKey: perplexityKey ?? null,
    });

    if (verification.success) {
      if (verification.success.source === "ticketmaster") result.verified_ticketmaster++;
      else result.verified_perplexity++;
      if (recover && row.active !== true) result.recovered++;

      if (!dryRun) {
        await updatePackage(sb, row.id, {
          active: true,
          verification_status: "verified",
          verification_fail_count: 0,
          last_verification_at: nowIso,
          last_verification_source: verification.success.source,
          verification_notes: `Confirmed ${artist} in ${city} on ${eventYmd}`,
          verification_evidence_url: verification.success.url ?? null,
          last_ticketmaster_check_at: nowIso,
          ticketmaster_last_ok: verification.success.source === "ticketmaster",
        });

        const evId = ev?.id ?? row.event_id;
        const linkType = verification.success.ticketmaster?.book_link?.link_type;
        const newUrl = verification.success.ticketmaster?.book_url?.trim();
        if (evId && linkType === "direct_event" && newUrl && newUrl.startsWith("https://")) {
          const old = ev?.ticket_url ?? "";
          if (old !== newUrl) {
            await sb
              .from("events")
              .update({ ticket_url: newUrl, updated_at: nowIso })
              .eq("id", evId);
            result.ticket_url_refreshed++;
          }
        }
      }

      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: "verified",
        source: verification.success.source,
        ticketmaster_venue: verification.success.ticketmaster?.venue?.name,
      });
    } else {
      if (verification.failure?.providerError) {
        result.provider_errors++;
        result.details.push({
          package_id: row.id,
          name: row.name,
          outcome: "skipped",
          reason: verification.failure.reason,
          ...(verification.failure.ticketmasterVenue ? { ticketmaster_venue: verification.failure.ticketmasterVenue } : {}),
        });
        console.warn(`[verify-packages] provider error for ${row.id} — ${verification.failure.reason}`);
        continue;
      }

      const failureCount = nextFailureCount(row, today);
      const hide = failureCount >= FAILURE_THRESHOLD;
      if (hide) {
        result.deactivated++;
        result.second_failed_hidden++;
      } else {
        result.first_failed++;
      }

      if (!dryRun) {
        const patch: Record<string, unknown> = {
          active: hide ? false : row.active,
          verification_status: hide ? "failed_twice" : "needs_review",
          verification_fail_count: failureCount,
          last_verification_at: nowIso,
          last_verification_failed_at: nowIso,
          last_verification_source: "system",
          verification_notes: verification.failure?.reason ?? "verification failed",
          verification_evidence_url: null,
          last_ticketmaster_check_at: nowIso,
          ticketmaster_last_ok: false,
        };
        if (hide) {
          patch.featured = false;
        }
        await updatePackage(sb, row.id, patch);
      }

      result.details.push({
        package_id: row.id,
        name: row.name,
        outcome: hide ? "hidden" : "needs_review",
        reason: verification.failure?.reason ?? "verification failed",
        fail_count: failureCount,
        ...(verification.failure?.ticketmasterVenue ? { ticketmaster_venue: verification.failure.ticketmasterVenue } : {}),
      });
      console.log(
        `[verify-packages] ${dryRun ? "[dry_run] " : ""}${hide ? "hidden" : "needs_review"} ${row.id} — ${verification.failure?.reason}`
      );
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
    `[verify-packages] done dry_run=${dryRun} recover=${recover} checked=${result.checked} tm=${result.verified_ticketmaster} perplexity=${result.verified_perplexity} first_failed=${result.first_failed} hidden=${result.second_failed_hidden} expired=${result.expired_hidden} skipped=${result.skipped_incomplete} urls=${result.ticket_url_refreshed}`
  );

  return json({ ...result, ...(suggest ? { metro_gaps } : {}) });
});
