# Handoff: Golf Verification "Cowork Agent" Effort — Experience Caddie

> Status: **parked / lower priority** (as of 2026-05-28). The automated
> `verify-golf-courses` function plus the admin Golf Review screen cover routine
> needs today. Revisit the cowork-agent automation when manual audit volume grows.

## What this is
Experience Caddie packages golf rounds with concerts into weekend trips. Golf course
data quality matters because bad courses (private clubs, indoor simulators, mini-golf)
must never surface in customer packages. A **"cowork agent"** (a Claude Cowork session
with browser access) periodically audits low-confidence golf courses by visiting their
websites, then generates SQL to apply its decisions. That SQL is brought into Cursor,
schema-checked, dry-run, and committed to the production Supabase database.

## Data model (two tables)
- **`golf_courses`** — current state of each course (location, quality,
  `verification_status`, `course_type`, `public_access_confidence`, `package_eligible`,
  audit metadata fields).
- **`golf_course_verification_events`** — append-only audit history. One row per decision.
  Columns: `golf_course_id` (uuid FK), `actor` (text), `method` (text), `previous_status`,
  `new_status`, `previous_course_type`, `new_course_type`, `confidence` (**text**, e.g.
  `'high (0.90)'` or `'0.75'`), `excluded_reason`, `evidence_summary`, `raw_inputs` (jsonb),
  `raw_outputs` (jsonb), `external_refs` (jsonb), `occurred_at`, `created_at`.

**`verification_status` values:** `verified`, `unreviewed`, `needs_review`, `excluded`

**`course_type` allowed values (CHECK constraint):** `public`, `semi_private`, `resort`,
`municipal`, `private`, `military`, `unknown`, `simulator`, `driving_range`, `mini_golf`,
`not_golf`

**Package/search eligibility rule:** `active=true` AND
`verification_status IN ('verified','unreviewed')` AND
`public_access_confidence IN ('likely_public','unknown')` AND
`course_type` is NULL or NOT IN (`private`,`semi_private`,`resort`,`military`) AND
name doesn't look like Topgolf/mini-golf/simulator/driving-range/military.

## Runs completed so far
- **Pilot batch (50 courses, May 10):** 30 held verified, 15 excluded, 5 → needs_review,
  11 flagged manual_review_needed. Applied successfully.
- **Batch 2 (100 courses):** 39 verified, 60 excluded, 1 needs_review. Applied successfully.
  (Regenerated with real page-fetch evidence after an initial egress-blocked pass.)
- After these + an automated backlog burn-down, `unreviewed` reached **0**; ~7 courses sit
  in `needs_review` for manual admin review.

## The manual workflow (current state — NOT automated)
1. Kick off a Cowork session → it browses courses and produces three files:
   `verification_events.sql` (INSERTs into the events table), `courses_update.sql`
   (UPDATEs to golf_courses), and a `*_summary.md`.
2. Files land in `C:\Users\Keating Home\OneDrive\Desktop\Golf_Concert Concierge\golf-verification\`
   (batch subfolders like `batch-2\`).
3. In Cursor: schema-check the SQL against live tables → dry-run wrapped in
   `BEGIN; … ROLLBACK;` → if clean, run real `BEGIN; … COMMIT;`.
   **Events file first, then updates file.**

## Schema gotchas that have bitten us (watch for these in agent output)
- Agent used `course_id` once; the real column is **`golf_course_id`**.
- `confidence` is a **text** column — numeric values must be quoted (`'0.75'`).
- The `course_type` CHECK constraint originally lacked
  `simulator`/`driving_range`/`mini_golf`/`not_golf`; migration
  `20260528000000_golf_course_type_expansion.sql` added them. If the agent invents a new
  type, the UPDATE will fail the constraint.

## Automation options discussed (no decision made yet)
- **Option A — keep manual/occasional:** run the cowork agent a few times a year for deep
  audits on top of the in-house automated `verify-golf-courses` function. Lowest effort.
- **Option B — targeted runs:** export the current `needs_review` list to CSV, hand only
  those to the agent, bring its SQL back to Cursor. Focused, no wasted work.
- **Option C — Edge Function `/apply-agent-batch`:** agent POSTs JSON directly to a new
  Supabase Edge Function (service-role auth); you review a summary and approve with one
  call. No SQL files / no Cursor. The automation "prize," worth building once runs are
  frequent.

## Related automated piece (separate from cowork agent)
There's an in-house `verify-golf-courses` Edge Function (Google Places Pass 1 + Perplexity
Pass 2) that runs **monthly** via GitHub Actions (`0 6 1 * *`). It handles routine
new-course verification; the cowork agent is for deeper/manual audits the automated
verifier can't resolve.

## Key file paths
- Verifier function: `apps/web/supabase/functions/verify-golf-courses/index.ts`
- Workflow: `.github/workflows/verify-golf-courses.yml`
- Admin review UI: `apps/web/src/pages/GolfReview.tsx`
- Model docs: `docs/GOLF_VERIFICATION_MODEL.md`
- Supabase project ref: `kxibaydbhquospzoefva`
