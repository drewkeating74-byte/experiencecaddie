/**
 * package-quality-monitor — Daily review of newly generated itinerary packages.
 *
 * Reviews package tiers stored in public.itineraries.result_json for itineraries
 * created in the last 24 hours. Sends a Resend alert only when quality rules
 * fail or an internal score is below 6/10.
 *
 * Auth: x-monitor-secret: <PACKAGE_QUALITY_MONITOR_SECRET>
 *   or Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPORT_TO = "drew@experiencecaddie.com";
const PERPLEXITY_MODEL = "sonar-pro";
const MAX_PACKAGES_PER_RUN = 30;

type JsonRecord = Record<string, unknown>;

type ItineraryRow = {
  id: string;
  city: string | null;
  start_date: string | null;
  end_date: string | null;
  event_details: string | null;
  created_at: string;
  result_json: JsonRecord | null;
};

type ResultPackage = {
  tier?: string;
  city?: string;
  events?: JsonRecord[];
  hotels?: JsonRecord[];
  lodging?: JsonRecord[];
  golf?: JsonRecord[];
  itinerary?: JsonRecord[];
  safety_notes?: string;
  why?: string;
};

type GolfCourseRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  public_access: boolean | null;
  public_access_confidence: string | null;
  course_type: string | null;
  verification_status: string | null;
  excluded_reason: string | null;
  normalized_quality_score: number | null;
  rating: number | null;
  user_rating_count: number | null;
};

type LlmAudit = {
  golf_course_rating: string;
  internal_score: number;
  score_reasoning: string;
  drive_minutes?: {
    golf_to_hotel?: number | null;
    hotel_to_venue?: number | null;
    golf_to_venue?: number | null;
  };
};

type PackageReview = {
  package_id: string;
  itinerary_id: string;
  tier: string;
  package_name: string;
  rules_passed: string[];
  rules_failed: string[];
  golf_course_rating: string;
  internal_score: number;
  score_reasoning: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function toYmd(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  const iso = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function driveMinutesFromCoords(a: JsonRecord | GolfCourseRow | null, b: JsonRecord | GolfCourseRow | null): number | null {
  if (!a || !b) return null;
  const aLat = num("lat" in a ? a.lat : undefined);
  const aLng = num("lng" in a ? a.lng : undefined);
  const bLat = num("lat" in b ? b.lat : undefined);
  const bLng = num("lng" in b ? b.lng : undefined);
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;
  // Conservative drive-time estimate: 2 minutes per mile, with a 10-minute floor.
  return Math.round(Math.max(10, haversineMiles(aLat, aLng, bLat, bLng) * 2));
}

function extractPackages(resultJson: JsonRecord | null): ResultPackage[] {
  const raw = resultJson?.packages;
  return Array.isArray(raw) ? raw.filter((p): p is ResultPackage => typeof p === "object" && p !== null) : [];
}

function firstEvent(pkg: ResultPackage): JsonRecord | null {
  return Array.isArray(pkg.events) && pkg.events.length > 0 ? pkg.events[0] : null;
}

function firstGolf(pkg: ResultPackage): JsonRecord | null {
  return Array.isArray(pkg.golf) && pkg.golf.length > 0 ? pkg.golf[0] : null;
}

function firstHotel(pkg: ResultPackage): JsonRecord | null {
  const hotels = Array.isArray(pkg.hotels) && pkg.hotels.length > 0 ? pkg.hotels : pkg.lodging;
  return Array.isArray(hotels) && hotels.length > 0 ? hotels[0] : null;
}

function eventVenueObject(event: JsonRecord | null): JsonRecord | null {
  if (!event) return null;
  const venueObj = event.venue_obj;
  if (venueObj && typeof venueObj === "object") return venueObj as JsonRecord;
  const venue = event.venue;
  return venue && typeof venue === "object" ? venue as JsonRecord : null;
}

function venueLabel(event: JsonRecord | null): string {
  if (!event) return "";
  const venue = event.venue;
  if (typeof venue === "string") return venue;
  if (venue && typeof venue === "object") {
    const v = venue as JsonRecord;
    return [str(v.name), str(v.city), str(v.state)].filter(Boolean).join(", ");
  }
  const venueObj = event.venue_obj;
  if (venueObj && typeof venueObj === "object") {
    const v = venueObj as JsonRecord;
    return [str(v.name), str(v.city), str(v.state)].filter(Boolean).join(", ");
  }
  return "";
}

function packageText(pkg: ResultPackage): string {
  return JSON.stringify({
    tier: pkg.tier,
    city: pkg.city,
    events: pkg.events,
    golf: pkg.golf,
    hotels: pkg.hotels ?? pkg.lodging,
    itinerary: pkg.itinerary,
    safety_notes: pkg.safety_notes,
    why: pkg.why,
  }).slice(0, 6000);
}

const WEEKDAY_GOLF_DAYS = ["monday", "tuesday", "wednesday"];

function itineraryHasWeekdayGolf(pkg: ResultPackage): boolean {
  if (!Array.isArray(pkg.itinerary)) return false;

  return pkg.itinerary.some((day) => {
    if (!day || typeof day !== "object") return false;
    const dayLabel = str(day.day).toLowerCase();
    const planItems = Array.isArray(day.plan) ? day.plan.map((item) => str(item)) : [str(day.plan)];
    const dayIsRestricted = WEEKDAY_GOLF_DAYS.some((weekday) => dayLabel.includes(weekday));
    const golfRegex = /\b(golf|tee time|tee-time|tee off|tee-off|course|round)\b/i;
    if (dayIsRestricted && planItems.some((item) => golfRegex.test(item))) return true;

    return planItems.some((item) => {
      const text = item.toLowerCase();
      return WEEKDAY_GOLF_DAYS.some((weekday) => text.includes(weekday)) && golfRegex.test(item);
    });
  });
}

function isMockGolfName(name: string): boolean {
  return /\b(mock|sample|placeholder|test|demo|fake|lorem|example)\b/i.test(name);
}

function isNonCourseGolfExperience(name: string): boolean {
  return /\b(topgolf|driving range|practice range|simulator|indoor golf|mini golf|putt[- ]?putt|putting course|golf lounge|golf bar)\b/i.test(name);
}

function isPrivateGolfByName(name: string): boolean {
  if (/municipal|muny|public\b|city\b|park\b|recreation|community\b/i.test(name)) return false;
  return /\b(private|members[- ]only|member guests?|invitation[- ]only|invite[- ]only|military[- ]only|reciprocal only|country club|golf and country|golf & country|military|naval|navy|marine corps|air force|army|coast guard|base|mwr|dod|camp pendleton|miramar|sea 'n air|sea n air)\b/i.test(name);
}

function requestedSpecificMusicGenre(eventDetails: string | null): boolean {
  const details = (eventDetails ?? "").toLowerCase();
  const match = details.match(/genres:\s*(.+)$/i);
  if (!match) return false;
  const genreText = match[1].trim();
  if (!genreText || genreText === "any") return false;
  return /\b(country|rock|pop|hip[- ]?hop|rap|edm|electronic|techno|house|r&b|soul|latin|jazz|blues|metal|alternative|punk)\b/i.test(
    genreText
  );
}

function eventLooksLikePerformingArts(eventName: string, venue: string): boolean {
  const blob = `${eventName} ${venue}`.toLowerCase();
  return /\b(nutcracker|ballet|opera|orchestra|symphony|theatre|theater|performing arts|stageplay|musical)\b/i.test(blob);
}

function golfAccessFails(course: GolfCourseRow | null, golfName: string): string[] {
  const failed: string[] = [];
  if (isPrivateGolfByName(golfName)) failed.push("golf_name_private_or_restricted");
  if (!course) return failed;
  if (course.verification_status === "excluded" || course.excluded_reason) failed.push("golf_verification_excluded");
  if (course.public_access === false) failed.push("golf_public_access_false");
  if (course.public_access_confidence === "likely_private") failed.push("golf_likely_private");
  if (["private", "military"].includes(course.course_type ?? "")) failed.push("golf_course_type_restricted");
  return [...new Set(failed)];
}

async function findGolfCourse(
  sb: ReturnType<typeof createClient>,
  golfName: string
): Promise<GolfCourseRow | null> {
  if (!golfName.trim()) return null;
  const select =
    "id,name,city,state,lat,lng,public_access,public_access_confidence,course_type,verification_status,excluded_reason,normalized_quality_score,rating,user_rating_count";

  const exact = await sb
    .from("golf_courses")
    .select(select)
    .ilike("name", golfName)
    .limit(5);

  const exactRows = Array.isArray(exact.data) ? exact.data as GolfCourseRow[] : [];
  if (exactRows.length > 0) return exactRows[0];

  const tokens = normalizeName(golfName).split(" ").filter((t) => t.length > 3).slice(0, 4);
  if (tokens.length === 0) return null;
  const broad = await sb
    .from("golf_courses")
    .select(select)
    .ilike("name", `%${tokens[0]}%`)
    .limit(20);

  const rows = Array.isArray(broad.data) ? broad.data as GolfCourseRow[] : [];
  const target = normalizeName(golfName);
  return rows.find((r) => normalizeName(r.name) === target || target.includes(normalizeName(r.name)) || normalizeName(r.name).includes(target)) ?? rows[0] ?? null;
}

function extractJsonObject(raw: string): JsonRecord {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
  return JSON.parse(cleaned) as JsonRecord;
}

async function askPerplexityForAudit(params: {
  apiKey: string;
  itinerary: ItineraryRow;
  pkg: ResultPackage;
  event: JsonRecord | null;
  golf: JsonRecord | null;
  hotel: JsonRecord | null;
  golfCourse: GolfCourseRow | null;
}): Promise<LlmAudit> {
  const golfName = str(params.golf?.name) || params.golfCourse?.name || "Unknown golf course";
  const prompt = `Audit this Experience Caddie golf + concert package.

Return ONLY valid JSON with this shape:
{
  "golf_course_rating": "Golf Digest/GOLF Magazine/public rating or 'unrated: <brief reason>'",
  "internal_score": 1-10,
  "score_reasoning": "2-4 concise sentences explaining concert quality, golf quality, package coherence, and logistics",
  "drive_minutes": {
    "golf_to_hotel": number|null,
    "hotel_to_venue": number|null,
    "golf_to_venue": number|null
  }
}

Scoring rubric:
- Concert quality: 3 points for notable artist/event, venue, demand/buzz
- Golf quality: 3 points for public rating/ranking, reviews, destination quality
- Package coherence: 2 points for whether the components feel curated together
- Logistics: 2 points for whether drives are under 60 minutes and hotel positioning/timing makes sense

Research the golf course using Golf Digest Best Courses, GOLF Magazine Top 100, and public course ratings/reviews. If no public rating/ranking is findable, say unrated but do not automatically fail the package.

Package context:
Itinerary city: ${params.itinerary.city ?? ""}
Trip window: ${params.itinerary.start_date ?? ""} to ${params.itinerary.end_date ?? ""}
Tier: ${params.pkg.tier ?? ""}
Concert: ${str(params.event?.name)} at ${venueLabel(params.event)} on ${str(params.event?.date_time)}
Golf: ${golfName}, ${params.golfCourse?.city ?? str(params.golf?.city)}, ${params.golfCourse?.state ?? str(params.golf?.state)}
Hotel/lodging: ${str(params.hotel?.name)} ${str(params.hotel?.area)}
Known golf DB fields: ${JSON.stringify(params.golfCourse ?? {})}
Package JSON excerpt: ${packageText(params.pkg)}
`;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: "system", content: "You are a strict package quality auditor. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Perplexity API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = extractJsonObject(content);
  const score = Math.max(1, Math.min(10, Number(parsed.internal_score) || 6));
  const drive = parsed.drive_minutes && typeof parsed.drive_minutes === "object"
    ? parsed.drive_minutes as LlmAudit["drive_minutes"]
    : undefined;
  return {
    golf_course_rating: str(parsed.golf_course_rating) || "unrated: no public rating found",
    internal_score: score,
    score_reasoning: str(parsed.score_reasoning) || "Perplexity returned no score reasoning.",
    drive_minutes: drive,
  };
}

function fallbackAudit(golfCourse: GolfCourseRow | null, reason: string): LlmAudit {
  const rating = golfCourse?.rating != null
    ? `Public rating ${golfCourse.rating}${golfCourse.user_rating_count ? ` (${golfCourse.user_rating_count} reviews)` : ""}`
    : "unrated: no public Golf Digest/GOLF Magazine rating found during automated check";
  return {
    golf_course_rating: rating,
    internal_score: 6,
    score_reasoning: `Fallback score used because Perplexity audit failed: ${reason}`,
  };
}

function collectDriveFailures(audit: LlmAudit, deterministic: Record<string, number | null>): string[] {
  const values = {
    golf_to_hotel: audit.drive_minutes?.golf_to_hotel ?? deterministic.golf_to_hotel,
    hotel_to_venue: audit.drive_minutes?.hotel_to_venue ?? deterministic.hotel_to_venue,
    golf_to_venue: audit.drive_minutes?.golf_to_venue ?? deterministic.golf_to_venue,
  };
  return Object.entries(values)
    .filter(([, minutes]) => typeof minutes === "number" && minutes > 60)
    .map(([leg, minutes]) => `drive_time_${leg}_over_60_min_${minutes}`);
}

async function reviewPackage(params: {
  sb: ReturnType<typeof createClient>;
  perplexityKey: string;
  itinerary: ItineraryRow;
  pkg: ResultPackage;
  today: string;
  minConcertYmd: string;
}): Promise<PackageReview> {
  const tier = str(params.pkg.tier).toUpperCase() || "PACKAGE";
  const packageId = `${params.itinerary.id}:${tier}`;
  const event = firstEvent(params.pkg);
  const golf = firstGolf(params.pkg);
  const hotel = firstHotel(params.pkg);
  const eventDate = toYmd(event?.date_time);
  const golfName = str(golf?.name);
  const golfCourse = await findGolfCourse(params.sb, golfName);

  const rulesPassed: string[] = [];
  const rulesFailed: string[] = [];

  if (eventDate && eventDate >= params.today) rulesPassed.push("concert_date_not_past");
  else rulesFailed.push("concert_date_missing_or_past");

  if (eventDate && eventDate >= params.minConcertYmd) rulesPassed.push("concert_date_at_least_14_days_out");
  else rulesFailed.push("concert_date_less_than_14_days_out");

  if (event && str(event.name) && Array.isArray(params.pkg.events) && params.pkg.events.length > 0) {
    rulesPassed.push("concert_anchor_experience_present");
  } else {
    rulesFailed.push("concert_anchor_missing");
  }

  if (
    event &&
    requestedSpecificMusicGenre(params.itinerary.event_details) &&
    eventLooksLikePerformingArts(str(event.name), venueLabel(event))
  ) {
    rulesFailed.push("concert_does_not_match_requested_music_genre");
  } else if (event) {
    rulesPassed.push("concert_matches_requested_music_context");
  }

  if (!golfName) {
    rulesFailed.push("golf_course_missing");
  } else {
    const accessFails = golfAccessFails(golfCourse, golfName);
    if (accessFails.length > 0) rulesFailed.push(...accessFails);
    else rulesPassed.push("golf_course_public_access_not_flagged");

    if (isMockGolfName(golfName)) rulesFailed.push("golf_course_mock_placeholder_or_test");
    else rulesPassed.push("golf_course_not_mock_placeholder_or_test");

    if (isNonCourseGolfExperience(golfName)) rulesFailed.push("golf_is_not_traditional_course");
    else rulesPassed.push("golf_is_traditional_course");
  }

  if (itineraryHasWeekdayGolf(params.pkg)) rulesFailed.push("golf_scheduled_on_monday_tuesday_or_wednesday");
  else rulesPassed.push("golf_scheduled_on_weekend_window_or_not_dated");

  let audit: LlmAudit;
  try {
    audit = await askPerplexityForAudit({
      apiKey: params.perplexityKey,
      itinerary: params.itinerary,
      pkg: params.pkg,
      event,
      golf,
      hotel,
      golfCourse,
    });
  } catch (err) {
    audit = fallbackAudit(golfCourse, err instanceof Error ? err.message : String(err));
    rulesFailed.push("perplexity_audit_failed");
  }

  const venueObj = eventVenueObject(event);
  const deterministicDrives = {
    golf_to_hotel: driveMinutesFromCoords(golfCourse ?? golf, hotel),
    hotel_to_venue: driveMinutesFromCoords(hotel, venueObj),
    golf_to_venue: driveMinutesFromCoords(golfCourse ?? golf, venueObj),
  };
  const driveFails = collectDriveFailures(audit, deterministicDrives);
  if (driveFails.length > 0) rulesFailed.push(...driveFails);
  else rulesPassed.push("drive_times_under_60_minutes_when_known");

  return {
    package_id: packageId,
    itinerary_id: params.itinerary.id,
    tier,
    package_name: `${tier} ${str(event?.name) || "package"} + ${golfName || "golf"}`,
    rules_passed: [...new Set(rulesPassed)],
    rules_failed: [...new Set(rulesFailed)],
    golf_course_rating: audit.golf_course_rating,
    internal_score: audit.internal_score,
    score_reasoning: audit.score_reasoning,
  };
}

function buildEmailHtml(reviews: PackageReview[], sinceIso: string): string {
  const failed = reviews.filter((r) => r.rules_failed.length > 0);
  const low = reviews.filter((r) => r.internal_score < 6);
  const rows = reviews
    .map((r) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(r.package_id)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(r.package_name)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${r.internal_score}/10</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(r.rules_failed.join(", ") || "none")}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(r.golf_course_rating)}</td>
        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(r.score_reasoning)}</td>
      </tr>`)
    .join("");

  return `<!doctype html>
<html>
<body style="font-family:Arial,sans-serif;line-height:1.45;">
  <h2>Experience Caddie Package Quality Monitor</h2>
  <p>Reviewed generated itinerary packages since ${escapeHtml(sinceIso)}.</p>
  <ul>
    <li>Total packages reviewed: ${reviews.length}</li>
    <li>Passed all quality checks: ${reviews.length - failed.length}</li>
    <li>Failed quality checks: ${failed.length}</li>
    <li>Scored below 6/10: ${low.length}</li>
  </ul>
  ${low.length ? `<p style="color:#b91c1c;font-weight:bold;">Packages below 6/10 require review: ${escapeHtml(low.map((r) => r.package_id).join(", "))}</p>` : ""}
  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <thead>
      <tr>
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Package ID</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Package</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Score</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Failed Rules</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Golf Rating/Ranking</th>
        <th style="padding:8px;border:1px solid #ddd;text-align:left;">Reasoning</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

async function sendEmail(params: { html: string; subject: string }): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL");
  if (!resendKey || !fromEmail) throw new Error("RESEND_API_KEY or FROM_EMAIL not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [REPORT_TO],
      subject: params.subject,
      html: params.html,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend API error ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function logReviews(
  sb: ReturnType<typeof createClient>,
  reviews: PackageReview[],
  runDate: string,
  emailSent: boolean
): Promise<void> {
  if (reviews.length === 0) return;
  const rows = reviews.map((r) => ({
    package_id: r.package_id,
    run_date: runDate,
    rules_passed: r.rules_passed,
    rules_failed: r.rules_failed,
    golf_course_rating: r.golf_course_rating,
    internal_score: r.internal_score,
    score_reasoning: r.score_reasoning,
    email_sent: emailSent,
  }));
  const { error } = await sb.from("package_quality_log").insert(rows);
  if (error) throw new Error(`package_quality_log insert failed: ${error.message}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return json({ error: "Method not allowed" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const monitorSecret = Deno.env.get("PACKAGE_QUALITY_MONITOR_SECRET");
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const monitorHeader = req.headers.get("x-monitor-secret")?.trim();
  const authorizedByServiceRole = Boolean(auth && auth === serviceKey);
  const authorizedByMonitorSecret = Boolean(monitorSecret && monitorHeader && monitorHeader === monitorSecret);
  if (!authorizedByServiceRole && !authorizedByMonitorSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY");
  if (!supabaseUrl || !serviceKey || !perplexityKey) {
    return json({ error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or PERPLEXITY_API_KEY" }, 500);
  }

  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const hours = Math.min(Math.max(Number(url.searchParams.get("hours") ?? "24") || 24, 1), 168);
    const now = new Date();
    const since = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
    const today = now.toISOString().slice(0, 10);
    const minConcertYmd = addDaysYmd(today, 14);
    const runDate = today;
    const sb = createClient(supabaseUrl, serviceKey);

    const { data, error } = await sb
      .from("itineraries")
      .select("id, city, start_date, end_date, event_details, created_at, result_json")
      .gte("created_at", since)
      .eq("status", "generated")
      .not("result_json", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(`itineraries query failed: ${error.message}`);

    const itineraries = (Array.isArray(data) ? data : []) as ItineraryRow[];
    const reviews: PackageReview[] = [];

    for (const itinerary of itineraries) {
      const pkgs = extractPackages(itinerary.result_json);
      for (const pkg of pkgs) {
        if (reviews.length >= MAX_PACKAGES_PER_RUN) break;
        reviews.push(await reviewPackage({ sb, perplexityKey, itinerary, pkg, today, minConcertYmd }));
      }
      if (reviews.length >= MAX_PACKAGES_PER_RUN) break;
    }

    const failed = reviews.filter((r) => r.rules_failed.length > 0);
    const lowScore = reviews.filter((r) => r.internal_score < 6);
    const shouldEmail = failed.length > 0 || lowScore.length > 0;

    let emailSent = false;
    if (shouldEmail && !dryRun) {
      await sendEmail({
        subject: `Experience Caddie package quality alert: ${failed.length} failed, ${lowScore.length} below 6/10`,
        html: buildEmailHtml(reviews, since),
      });
      emailSent = true;
    }

    if (!dryRun) await logReviews(sb, reviews, runDate, emailSent);

    if (!shouldEmail) {
      console.log(`[package-quality-monitor] success: ${reviews.length} package(s) reviewed; no alerts`);
    }

    return json({
      success: true,
      dry_run: dryRun,
      since,
      total_packages_reviewed: reviews.length,
      passed_all_quality_checks: reviews.filter((r) => r.rules_failed.length === 0).length,
      failed_quality_checks: failed.length,
      below_6: lowScore.length,
      email_sent: emailSent,
      reviews,
    });
  } catch (err) {
    console.error("[package-quality-monitor] error", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
