# Golf Verification Model

## Current Tables

`golf_courses` is the canonical current-state table for golf inventory. It stores the provider identity, location, quality fields, public-access classification, and the latest verification summary used by search and curated packages.

`golf_course_verification_events` is the append-only history table. Each automated agent or admin review writes an event that explains what changed, who/what changed it, and what evidence was used.

The old n8n-driven `golf_course_verifications` table is not used by the app code. Treat it as deprecated reference data only.

## Current-State Fields

Use these on `golf_courses` for fast filtering and display:

- `verification_status`: `verified`, `unreviewed`, `needs_review`, or `excluded`
- `course_type`: `public`, `municipal`, `unknown`, `semi_private`, `resort`, `private`, or `military`
- `public_access_confidence`: provider/name heuristic before full verification
- `last_verified_at`: when the course state was last set
- `verification_method`, `last_verified_by`, `last_agent_review_at`, `verification_evidence_summary`: latest review summary

## Event History

Use `golf_course_verification_events` for agent workflows, debugging, and data-quality review. Store the full decision trail there instead of adding more one-off columns to `golf_courses`.

Each event should include:

- `golf_course_id`
- `actor`
- `method`
- previous/new status and course type
- confidence and evidence summary
- structured provider/agent inputs in `raw_inputs`
- structured outputs or errors in `raw_outputs`
- provider links or IDs in `external_refs`

## Eligibility Rule

For user-facing package/search surfaces, a course should be eligible only when:

- `active = true`
- `verification_status IN ('verified', 'unreviewed')`
- `public_access_confidence IN ('likely_public', 'unknown')`
- `course_type IS NULL OR course_type NOT IN ('private', 'semi_private', 'resort', 'military')`
- the name does not look like Topgolf, mini golf, simulator, driving range, or military/base access

`needs_review` and `excluded` are not user-facing package candidates.
