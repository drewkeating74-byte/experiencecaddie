/**
 * verify-golf-courses — Scheduled automated verifier for golf course public access status
 *
 * PURPOSE
 * -------
 * Runs a two-pass verification over golf_courses, updating verification_status,
 * course_type, and related audit fields so the search catalog only surfaces
 * courses that are genuinely accessible to the general public.
 *
 * PASS 1 — Rule-based (no LLM cost)
 *   Processes up to MAX_RULE_BASED_PER_RUN courses where verification_status
 *   is 'unreviewed' OR NULL (catalog upserts omitted the column — treat as
 *   never reviewed). Any public_access_confidence is allowed.
 *   Fetches Google Place Details (reservable, editorialSummary, priceLevel) for each.
 *   Decision logic:
 *     • likely_public + (reservable=true OR clear public editorial text) → verified
 *     • likely_public + clearly negative editorial (private/members keywords) → needs_review
 *     • likely_public + no decisive signal → needs_review (escalated to LLM)
 *   NEVER sets excluded in this pass. Excluded requires LLM confirmation.
 *
 *   Previously, "no decisive signal" left the course as unreviewed — which
 *   meant it stayed eligible for packages without ever being confirmed.
 *   That is the wrong default for a trust-critical product. Ambiguous
 *   courses are now escalated so the LLM pass examines them.
 *
 * PASS 2 — LLM-assisted via Perplexity sonar (cost-controlled)
 *   Processes up to MAX_LLM_PER_RUN courses where verification_status = 'needs_review'.
 *   (Previously also filtered by public_access_confidence, which left
 *   likely_public + needs_review courses stuck in limbo — neither pass
 *   touched them. That filter is now removed.)
 *   Calls Perplexity with web search to determine access status.
 *   Possible outcomes: verified | needs_review | excluded
 *   An excluded outcome requires positive private-access evidence in the LLM response.
 *
 * PER-RUN CAPS
 *   MAX_RULE_BASED_PER_RUN = 50   (Places API — low cost)
 *   MAX_LLM_PER_RUN        = 50   (Perplexity)
 *
 * Do not run Pass 1 + Pass 2 in one long invocation during big backlogs:
 * Supabase returns HTTP 546 (WORKER_LIMIT) when wall-clock exceeds the Edge
 * budget. GitHub Actions calls the function twice: skip_llm (Pass 1 only),
 * then skip_pass1 (Pass 2 only). Single-shot { } still works from the
 * dashboard but may 546 when APIs are slow.
 *
 * SCHEDULE (see verify-golf-courses.yml)
 *   Monthly (1st of month, 06:00 UTC) — each run is two HTTP calls (rule, then LLM).
 *   Dispatch manually several times in a row to burn down a large backlog.
 *
 * DB FIELDS UPDATED
 *   verification_status, course_type, excluded_reason, public_access,
 *   public_access_confidence (when LLM overrides name heuristic),
 *   verification_method, last_verified_by, last_agent_review_at,
 *   verification_evidence_summary, last_verified_at
 *
 * SCHEDULING
 *   Monthly at 06:00 UTC on the 1st via verify-golf-courses.yml
 *   Requires Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RULE_BASED_PER_RUN = 50;
const MAX_LLM_PER_RUN = 50;
const VERIFIER_VERSION = "verify-golf-courses-v1";
const PERPLEXITY_MODEL = "sonar";

// Patterns used in rule-based pass for editorial text analysis
const PRIVATE_EDITORIAL_RE =
  /\b(private\s+club|members[- ]only|members'?\s+club|by\s+invitation|invitation[- ]only|no\s+public\s+play|reciprocal\s+only|exclusive\s+membership|membership\s+required)\b/i;
const PUBLIC_EDITORIAL_RE =
  /\b(public\s+(golf\s+)?course|open\s+to\s+the\s+public|daily\s+fee|municipal|walk[- ]ins?\s+welcome|tee\s+times?\s+available|book\s+a\s+tee\s+time)\b/i;

// The approved verifier system prompt (see Task 1 approval)
const VERIFIER_SYSTEM_PROMPT = `You are a golf course access verifier for Experience Caddie, a travel booking
platform that packages golf rounds with live events into weekend trips.

YOUR JOB: Determine whether a specific golf course is open to the GENERAL PUBLIC
for tee time bookings — meaning any paying adult can book a round without club
membership, private invitation, or reciprocal access arrangement.

THIS IS A TRUST-CRITICAL TASK. Users book flights and hotels based on these
recommendations. A user directed to a private club they cannot access is the
most serious product failure this platform can make.

═══ INPUTS ═══

You will receive a JSON object with:
  - name: course name
  - city, state: location
  - public_access_confidence: name heuristic — "likely_public", "unknown",
    or "likely_private"
  - places_data: { reservable, editorialSummary, types, priceLevel,
    businessStatus, websiteUri } — may be partial or null

═══ CLASSIFICATION RULES (apply in strict order) ═══

── EXCLUDED ──────────────────────────────────────────────────────────────────
Apply ONLY when you have POSITIVE EVIDENCE of private access from at least one
concrete signal. NEVER exclude based on name alone.

Evidence that justifies EXCLUDED:
  • Website or any booking listing explicitly states: "members only",
    "by invitation only", "private club", "no public play",
    "reciprocal play only", "member guests only"
  • Course has NO presence on any public tee time platform (GolfNow, TeeOff,
    EZLinks, Supreme Golf, BirdEase, ForeUp) AND other signals confirm private
  • places_data.reservable = false AND editorialSummary explicitly confirms
    private or members-only membership
  • Multiple independent sources consistently indicate no public access

── NEEDS_REVIEW ──────────────────────────────────────────────────────────────
Apply when you cannot confidently confirm OR deny public access.

  • Name contains "Country Club", "CC", "Athletic Club", "Golf & Country",
    or "Golf and Country" WITHOUT hotel/resort branding, AND no booking
    platform presence confirmed in your search
  • places_data.reservable = false with no other confirming private signals
  • Website is inaccessible, does not exist, or says nothing about public play
  • Conflicting signals from different sources
  • public_access_confidence = "unknown" with insufficient clarifying data
  • Any case where you are genuinely uncertain

── VERIFIED ──────────────────────────────────────────────────────────────────
Apply only when you have POSITIVE EVIDENCE of public access.

  • Course appears on GolfNow, TeeOff, Supreme Golf, EZLinks, or any public
    tee time platform with actual bookable slots
  • Website explicitly mentions "public tee times", "book a tee time",
    "daily fee", "open to the public", or "walk-ons welcome"
  • places_data.reservable = true
  • Course is described as municipal, public, or daily-fee in a reliable source
  • public_access_confidence = "likely_public" with no contradictory signals

DEFAULT: When uncertain between NEEDS_REVIEW and EXCLUDED, always choose
NEEDS_REVIEW. A false negative (blocking a public course) is recoverable.
A false positive (sending a user to a private club) is not.

═══ RESPONSE FORMAT ═══

Return ONLY valid JSON — no markdown, no explanation, no other text:

{
  "verification_status": "verified" | "needs_review" | "excluded",
  "access_type": "public" | "municipal" | "resort" | "semi_private" |
                 "private" | "military" | "unknown",
  "confidence": "high" | "medium" | "low",
  "evidence": "<1–2 sentences: what signals you found and why you chose this status>",
  "excluded_reason": null | "private_club" | "members_only" | "no_public_access" | "invitation_only"
}`;

// ── Types ──────────────────────────────────────────────────────────────────────

interface GolfCourseRow {
  id: string;
  name: string;
  city: string;
  state: string;
  source_id: string | null;
  place_id: string | null;
  public_access_confidence: string | null;
  verification_status: string | null;
  course_type: string | null;
  excluded_reason: string | null;
}

interface PlaceDetails {
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  reservable?: boolean;
  editorialSummary?: { text?: string; languageCode?: string };
  priceLevel?: string;
}

interface LlmVerificationResult {
  verification_status: "verified" | "needs_review" | "excluded";
  access_type: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
  excluded_reason: string | null;
}

type CourseUpdate = {
  verification_status: string;
  course_type?: string;
  excluded_reason?: string | null;
  public_access?: boolean;
  public_access_confidence?: string;
  verification_method: string;
  last_verified_by: string;
  last_agent_review_at: string;
  verification_evidence_summary?: string;
  last_verified_at: string;
};

type VerificationEvent = {
  raw_inputs?: Record<string, unknown> | null;
  raw_outputs?: Record<string, unknown> | null;
  external_refs?: Record<string, unknown> | null;
  confidence?: string | null;
  evidence_summary?: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string
): Promise<PlaceDetails | null> {
  const id = placeId.replace(/^places\//, "");
  const url = `https://places.googleapis.com/v1/places/${id}`;
  const fieldMask = "websiteUri,googleMapsUri,rating,userRatingCount,businessStatus,reservable,editorialSummary,priceLevel";
  try {
    const res = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PlaceDetails;
  } catch {
    return null;
  }
}

function getPlaceId(row: GolfCourseRow): string | null {
  const raw = row.source_id ?? row.place_id;
  if (!raw) return null;
  return raw.startsWith("ChIJ") || raw.startsWith("places/") ? raw : null;
}

function editorialText(details: PlaceDetails): string {
  return details.editorialSummary?.text ?? "";
}

/**
 * Rule-based decision for any unreviewed course in the Pass 1 queue.
 *
 * Every ambiguous case is escalated to needs_review so the LLM pass examines
 * it. Leaving courses as unreviewed kept them eligible for packages without
 * confirmation, which was the root cause of private-club leaks (e.g.
 * UT Golf Club) reaching users.
 */
function ruleBasedDecision(
  row: GolfCourseRow,
  details: PlaceDetails | null
): { status: "verified" | "needs_review"; evidence: string } {
  if (!details) {
    return {
      status: "needs_review",
      evidence: "No Place Details available — escalated for LLM review.",
    };
  }

  const editorial = editorialText(details);

  // Positive: Google says this place is reservable → confirmed public
  if (details.reservable === true) {
    return {
      status: "verified",
      evidence: `Google Places reservable=true confirms the course accepts public bookings.${editorial ? ` Editorial: "${editorial.slice(0, 120)}"` : ""}`,
    };
  }

  // Positive: editorial text contains public-course language
  if (editorial && PUBLIC_EDITORIAL_RE.test(editorial)) {
    return {
      status: "verified",
      evidence: `Google Places editorial confirms public access: "${editorial.slice(0, 150)}"`,
    };
  }

  // Negative: editorial text explicitly indicates private/members access
  if (editorial && PRIVATE_EDITORIAL_RE.test(editorial)) {
    return {
      status: "needs_review",
      evidence: `Google Places editorial contains private/members language: "${editorial.slice(0, 150)}" — escalated for LLM review.`,
    };
  }

  // No decisive signal from Places — escalate to LLM rather than leaving
  // the course in the "eligible-but-unconfirmed" limbo.
  return {
    status: "needs_review",
    evidence: "No decisive signal from Place Details — escalated for LLM review.",
  };
}

/**
 * Sanitise the access_type from the LLM response to a value allowed by the
 * golf_courses.course_type constraint.
 */
function sanitiseAccessType(raw: string | undefined): string {
  const allowed = ["public", "semi_private", "resort", "municipal", "private", "military", "unknown"];
  const v = (raw ?? "").toLowerCase().replace(/-/g, "_");
  return allowed.includes(v) ? v : "unknown";
}

/**
 * Strip markdown fences and extract the first {...} JSON block from LLM output.
 */
function extractJson(raw: string): string {
  let s = raw.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
  if (!s.startsWith("{")) {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) s = s.slice(start, end + 1);
  }
  return s;
}

// ── Supabase DB update helper ──────────────────────────────────────────────────

async function updateCourse(
  supabase: SupabaseClient,
  row: GolfCourseRow,
  update: CourseUpdate,
  event: VerificationEvent = {}
): Promise<void> {
  const { error } = await supabase
    .from("golf_courses")
    .update(update)
    .eq("id", row.id);
  if (error) {
    console.error(`[VERIFY] DB update failed for ${row.id}:`, error.message);
    return;
  }

  const { error: eventError } = await supabase
    .from("golf_course_verification_events")
    .insert({
      golf_course_id: row.id,
      actor: update.last_verified_by,
      method: update.verification_method,
      previous_status: row.verification_status,
      new_status: update.verification_status,
      previous_course_type: row.course_type,
      new_course_type: update.course_type ?? row.course_type,
      confidence: event.confidence ?? null,
      excluded_reason: update.excluded_reason ?? null,
      evidence_summary: event.evidence_summary ?? update.verification_evidence_summary ?? null,
      raw_inputs: event.raw_inputs ?? null,
      raw_outputs: event.raw_outputs ?? null,
      external_refs: event.external_refs ?? null,
    });

  if (eventError) {
    console.error(`[VERIFY] Event insert failed for ${row.id}:`, eventError.message);
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const googleApiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY");

  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  let skipLlm = false;
  let skipPass1 = false;
  try {
    const body = await req.json().catch(() => ({}));
    skipLlm = body?.skip_llm === true;
    skipPass1 = body?.skip_pass1 === true;
  } catch { /* no body — run both passes */ }

  if (skipLlm && skipPass1) {
    return json({ error: "skip_llm and skip_pass1 cannot both be true" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const now = new Date().toISOString();

  const runStats = {
    pass1_processed: 0,
    pass1_verified: 0,
    pass1_escalated: 0,
    pass2_processed: 0,
    pass2_verified: 0,
    pass2_needs_review: 0,
    pass2_excluded: 0,
    pass2_errors: [] as string[],
  };

  // ── PASS 1: Rule-based for unreviewed courses ─────────────────────────────

  if (!skipPass1) {
    // Treat NULL verification_status as "never touched" — same as unreviewed.
    // Catalog refresh upserts omit this column; PostgREST left rows NULL after
    // the remediation migration widened the CHECK to allow NULL (Apr 2026).
    const { data: unreviewedRows, error: unreviewedErr } = await supabase
      .from("golf_courses")
      .select("id,name,city,state,source_id,place_id,public_access_confidence,verification_status,course_type,excluded_reason")
      .eq("active", true)
      .or("verification_status.eq.unreviewed,verification_status.is.null")
      .order("last_verified_at", { ascending: true, nullsFirst: true })
      .limit(MAX_RULE_BASED_PER_RUN);

    if (unreviewedErr) {
      console.error("[VERIFY] Pass 1 query error:", unreviewedErr.message);
    } else {
      for (const row of (unreviewedRows ?? []) as GolfCourseRow[]) {
        runStats.pass1_processed++;
        const placeId = getPlaceId(row);
        const details = placeId && googleApiKey
          ? await fetchPlaceDetails(placeId, googleApiKey)
          : null;

        const { status, evidence } = ruleBasedDecision(row, details);

        const update: CourseUpdate = {
          verification_status: status,
          public_access: status === "verified",
          verification_method: "rule_based",
          last_verified_by: VERIFIER_VERSION,
          last_agent_review_at: now,
          last_verified_at: now,
          verification_evidence_summary: evidence,
        };

        if (status === "verified") {
          runStats.pass1_verified++;
          update.course_type = "public";
        } else {
          runStats.pass1_escalated++;
        }

        await updateCourse(supabase, row, update, {
          evidence_summary: evidence,
          raw_inputs: {
            public_access_confidence: row.public_access_confidence,
            places_data: details
              ? {
                  reservable: details.reservable ?? null,
                  editorialSummary: details.editorialSummary?.text ?? null,
                  priceLevel: details.priceLevel ?? null,
                  businessStatus: details.businessStatus ?? null,
                  websiteUri: details.websiteUri ?? null,
                }
              : null,
          },
          raw_outputs: { status, evidence },
          external_refs: { place_id: placeId },
        });
        console.log(`[VERIFY] Pass1 ${status.toUpperCase().padEnd(12)} ${row.name} (${row.city}) — ${evidence.slice(0, 100)}`);
      }
    }
  } else {
    console.log("[VERIFY] Pass 1 skipped (skip_pass1=true) — LLM-only invocation");
  }

  // ── PASS 2: LLM-assisted for needs_review courses ─────────────────────────

  if (skipLlm) {
    console.log("[VERIFY] LLM pass skipped (skip_llm=true) — rule-based only run");
    return json({ ...runStats, skipped_llm_pass: true, skipped_pass1: skipPass1 });
  }

  if (!perplexityKey) {
    console.warn("[VERIFY] PERPLEXITY_API_KEY not set — skipping LLM pass");
    return json({ ...runStats, skipped_llm_pass: true, skipped_pass1: skipPass1 });
  }

  // Pull every needs_review course regardless of public_access_confidence.
  // The previous IN filter on ('unknown', 'likely_private') created a stuck
  // queue: courses with likely_public + needs_review were never examined
  // by any pass. Since needs_review status by itself already means "examine
  // this", the LLM should see all of them.
  const { data: needsReviewRows, error: needsReviewErr } = await supabase
    .from("golf_courses")
    .select("id,name,city,state,source_id,place_id,public_access_confidence,verification_status,course_type,excluded_reason")
    .eq("verification_status", "needs_review")
    .eq("active", true)
    .order("last_agent_review_at", { ascending: true, nullsFirst: true })
    .limit(MAX_LLM_PER_RUN);

  if (needsReviewErr) {
    console.error("[VERIFY] Pass 2 query error:", needsReviewErr.message);
    return json(runStats);
  }

  for (const row of (needsReviewRows ?? []) as GolfCourseRow[]) {
    runStats.pass2_processed++;

    const placeId = getPlaceId(row);
    const details = placeId && googleApiKey
      ? await fetchPlaceDetails(placeId, googleApiKey)
      : null;

    const userMessage = JSON.stringify({
      name: row.name,
      city: row.city,
      state: row.state,
      public_access_confidence: row.public_access_confidence,
      places_data: details
        ? {
            reservable: details.reservable ?? null,
            editorialSummary: details.editorialSummary?.text ?? null,
            priceLevel: details.priceLevel ?? null,
            businessStatus: details.businessStatus ?? null,
            websiteUri: details.websiteUri ?? null,
          }
        : null,
    }, null, 2);

    let llmResult: LlmVerificationResult | null = null;
    try {
      const resp = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${perplexityKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: PERPLEXITY_MODEL,
          messages: [
            { role: "system", content: VERIFIER_SYSTEM_PROMPT },
            { role: "user", content: `Verify the following golf course:\n\n${userMessage}` },
          ],
          temperature: 0.1,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Perplexity ${resp.status}: ${errText.slice(0, 200)}`);
      }

      const data = await resp.json();
      const raw = data.choices?.[0]?.message?.content ?? "";
      llmResult = JSON.parse(extractJson(raw)) as LlmVerificationResult;

      // Validate required fields
      if (!["verified", "needs_review", "excluded"].includes(llmResult.verification_status)) {
        throw new Error(`Unexpected verification_status: ${llmResult.verification_status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[VERIFY] Pass2 LLM error for ${row.name}:`, msg);
      runStats.pass2_errors.push(`${row.name}: ${msg}`);
      // Stamp last_agent_review_at so we don't immediately retry on next run
      await updateCourse(
        supabase,
        row,
        {
          verification_status: "needs_review",
          verification_method: "llm_perplexity",
          last_verified_by: VERIFIER_VERSION,
          last_agent_review_at: now,
          last_verified_at: now,
          verification_evidence_summary: `LLM call failed: ${msg.slice(0, 200)}`,
        },
        {
          evidence_summary: `LLM call failed: ${msg.slice(0, 200)}`,
          raw_inputs: { prompt: userMessage },
          raw_outputs: { error: msg.slice(0, 500) },
          external_refs: { place_id: placeId },
        },
      );
      continue;
    }

    const status = llmResult.verification_status;
    const accessType = sanitiseAccessType(llmResult.access_type);

    const update: CourseUpdate = {
      verification_status: status,
      course_type: accessType,
      excluded_reason: status === "excluded" ? (llmResult.excluded_reason ?? "no_public_access") : null,
      public_access: status === "verified",
      verification_method: "llm_perplexity",
      last_verified_by: VERIFIER_VERSION,
      last_agent_review_at: now,
      last_verified_at: now,
      verification_evidence_summary: llmResult.evidence?.slice(0, 500) ?? "",
    };

    // If LLM confirmed public for a likely_private course, fix the confidence too
    if (status === "verified" && row.public_access_confidence !== "likely_public") {
      update.public_access_confidence = "likely_public";
    }

    await updateCourse(supabase, row, update, {
      confidence: llmResult.confidence,
      evidence_summary: llmResult.evidence,
      raw_inputs: { prompt: userMessage },
      raw_outputs: llmResult as unknown as Record<string, unknown>,
      external_refs: { place_id: placeId },
    });

    if (status === "verified") runStats.pass2_verified++;
    else if (status === "excluded") runStats.pass2_excluded++;
    else runStats.pass2_needs_review++;

    console.log(
      `[VERIFY] Pass2 ${status.toUpperCase().padEnd(12)} ${row.name} (${row.city}) [${accessType}, ${llmResult.confidence}] — ${(llmResult.evidence ?? "").slice(0, 100)}`
    );
  }

  console.log(
    `[VERIFY] Done — Pass1: processed=${runStats.pass1_processed} verified=${runStats.pass1_verified} escalated=${runStats.pass1_escalated}` +
    ` | Pass2: processed=${runStats.pass2_processed} verified=${runStats.pass2_verified} needs_review=${runStats.pass2_needs_review} excluded=${runStats.pass2_excluded} errors=${runStats.pass2_errors.length}`
  );

  return json({ ...runStats, skipped_pass1: skipPass1, skipped_llm_pass: false });
});
