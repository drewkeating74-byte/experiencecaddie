import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RefreshCw, ExternalLink, ShieldAlert, Clock } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface GolfCourseRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  metro: string | null;
  verification_status: string | null;
  course_type: string | null;
  public_access_confidence: string | null;
  manual_review_needed: boolean | null;
  verification_method: string | null;
  last_verified_by: string | null;
  last_verified_at: string | null;
  excluded_reason: string | null;
  active: boolean | null;
  created_at: string | null;
}

// ── Badge helpers ──────────────────────────────────────────────────────────────

const STATUS_COLOURS: Record<string, string> = {
  verified:     "bg-green-100 text-green-800 border-green-200",
  unreviewed:   "bg-blue-100 text-blue-800 border-blue-200",
  needs_review: "bg-amber-100 text-amber-800 border-amber-200",
  excluded:     "bg-red-100 text-red-800 border-red-200",
};

const ACCESS_COLOURS: Record<string, string> = {
  public:       "bg-green-100 text-green-800 border-green-200",
  municipal:    "bg-cyan-100 text-cyan-800 border-cyan-200",
  resort:       "bg-purple-100 text-purple-800 border-purple-200",
  semi_private: "bg-orange-100 text-orange-800 border-orange-200",
  private:      "bg-red-200 text-red-900 border-red-400 font-semibold",
  unknown:      "bg-gray-100 text-gray-600 border-gray-200",
};

const CONFIDENCE_COLOURS: Record<string, string> = {
  likely_public:  "bg-green-50 text-green-700",
  unknown:        "bg-gray-50 text-gray-500",
  likely_private: "bg-red-50 text-red-700 font-medium",
};

function StatusBadge({ status }: { status: string | null }) {
  const cls = STATUS_COLOURS[status ?? ""] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {status ?? "—"}
    </span>
  );
}

function AccessBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-xs text-muted-foreground">—</span>;
  const cls = ACCESS_COLOURS[type] ?? ACCESS_COLOURS.unknown;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {type === "private" && <ShieldAlert className="mr-1 h-3 w-3" />}
      {type}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string | null }) {
  const label = confidence?.replace("likely_", "") ?? "—";
  const cls = CONFIDENCE_COLOURS[confidence ?? ""] ?? "bg-gray-50 text-gray-500";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs ${cls}`}>
      {label}
    </span>
  );
}

// ── Staleness threshold ────────────────────────────────────────────────────────

const STALE_DAYS = 30;

function isStale(last_verified_at: string | null): boolean {
  if (!last_verified_at) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);
  return new Date(last_verified_at) < cutoff;
}

// ── Determines whether a row should be visually highlighted as likely-private ─

function isPrivateConcern(row: GolfCourseRow): boolean {
  return row.course_type === "private" || row.public_access_confidence === "likely_private";
}

// ── EXCLUDE REASON OPTIONS ─────────────────────────────────────────────────────

const EXCLUDE_REASONS = [
  { value: "private_club",     label: "Private club / members only" },
  { value: "members_only",     label: "Members-only access confirmed" },
  { value: "no_public_access", label: "No public access (other reason)" },
  { value: "invitation_only",  label: "Invitation only" },
];

// ── Filter tabs ────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: "all",            label: "All" },
  { value: "review_queue",   label: "Review queue" },
  { value: "unreviewed",     label: "Unreviewed" },
  { value: "needs_review",   label: "Needs review" },
  { value: "verified",       label: "Verified" },
  { value: "excluded",       label: "Excluded" },
];

const PAGE_SIZE = 1000;

/** Canonical status string (null DB → treated as unreviewed for workflows). */
function effectiveStatus(raw: string | null): string {
  return canonStatus(raw) ?? "unreviewed";
}

function isInReviewQueue(raw: string | null): boolean {
  const s = effectiveStatus(raw);
  return s === "unreviewed" || s === "needs_review";
}

function isReviewQueueCourse(row: GolfCourseRow): boolean {
  return (
    isInReviewQueue(row.verification_status) ||
    (
      row.manual_review_needed === true &&
      row.verification_method === "agent_web_review" &&
      row.last_verified_by === "cowork_agent"
    )
  );
}

/** Normalize DB status for filtering (handles stray spaces / casing). */
function canonStatus(raw: string | null): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  return s || null;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function GolfReview() {
  const { user, isAdmin, loading: authLoading, adminChecked } = useAuth();
  const navigate = useNavigate();

  const [courses, setCourses] = useState<GolfCourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("review_queue");
  const [privateOnly, setPrivateOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);

  // Exclude dialog state
  const [excludeTarget, setExcludeTarget] = useState<GolfCourseRow | null>(null);
  const [excludeReason, setExcludeReason] = useState("private_club");

  useEffect(() => {
    if (!authLoading && adminChecked && (!user || !isAdmin)) {
      navigate("/");
    }
  }, [user, isAdmin, authLoading, adminChecked, navigate]);

  const loadCourses = async () => {
    setLoading(true);
    const cols =
      "id,name,city,state,metro,verification_status,course_type,public_access_confidence,manual_review_needed,verification_method,last_verified_by,last_verified_at,excluded_reason,active,created_at";

    const allRows: GolfCourseRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("golf_courses")
        .select(cols)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        toast.error("Failed to load courses: " + error.message);
        setCourses([]);
        setLoading(false);
        return;
      }

      const batch = (data ?? []) as GolfCourseRow[];
      allRows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }

    const rows = allRows.map((r) => ({
      ...r,
      verification_status: canonStatus(r.verification_status),
    }));

    const rank = (s: string | null) =>
      s === "unreviewed" || !s ? 0 : s === "needs_review" ? 1 : 2;

    rows.sort((a, b) => {
      const d = rank(a.verification_status) - rank(b.verification_status);
      if (d !== 0) return d;
      const ca = a.created_at ?? "";
      const cb = b.created_at ?? "";
      if (rank(a.verification_status) < 2) return cb.localeCompare(ca);
      return (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" });
    });

    setCourses(rows);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) loadCourses();
  }, [isAdmin]);

  const updateStatus = async (
    courseId: string,
    status: string,
    excluded_reason?: string | null,
  ) => {
    setUpdating(courseId);
    const previous = courses.find((c) => c.id === courseId);
    const payload: Record<string, unknown> = {
      verification_status: status,
      last_verified_at: new Date().toISOString(),
      verification_method: "manual_ui",
      last_verified_by: user?.id ? `admin:${user.id}` : "admin",
    };
    if (status === "excluded") {
      payload.excluded_reason = excluded_reason ?? "no_public_access";
    } else {
      payload.excluded_reason = null;
    }

    const { error } = await supabase
      .from("golf_courses")
      .update(payload)
      .eq("id", courseId);

    if (error) {
      toast.error("Update failed: " + error.message);
    } else {
      await supabase
        .from("golf_course_verification_events")
        .insert({
          golf_course_id: courseId,
          actor: user?.id ? `admin:${user.id}` : "admin",
          method: "manual_ui",
          previous_status: previous?.verification_status ?? null,
          new_status: status,
          previous_course_type: previous?.course_type ?? null,
          new_course_type: previous?.course_type ?? null,
          excluded_reason: status === "excluded" ? excluded_reason ?? "no_public_access" : null,
          evidence_summary: `Admin marked course ${status}`,
          raw_inputs: { source: "GolfReview" },
          raw_outputs: payload,
        });
      toast.success(`Course marked ${status}`);
      setCourses((prev) =>
        prev.map((c) => (c.id === courseId ? { ...c, ...payload } : c))
      );
    }
    setUpdating(null);
    setExcludeTarget(null);
  };

  const clearManualReview = async (courseId: string) => {
    setUpdating(courseId);
    const previous = courses.find((c) => c.id === courseId);
    const payload: Record<string, unknown> = {
      manual_review_needed: false,
      last_verified_at: new Date().toISOString(),
      verification_method: "manual_ui",
      last_verified_by: user?.id ? `admin:${user.id}` : "admin",
    };

    const { error } = await supabase
      .from("golf_courses")
      .update(payload)
      .eq("id", courseId);

    if (error) {
      toast.error("Clear review failed: " + error.message);
    } else {
      await supabase
        .from("golf_course_verification_events")
        .insert({
          golf_course_id: courseId,
          actor: user?.id ? `admin:${user.id}` : "admin",
          method: "manual_ui",
          previous_status: previous?.verification_status ?? null,
          new_status: previous?.verification_status ?? null,
          previous_course_type: previous?.course_type ?? null,
          new_course_type: previous?.course_type ?? null,
          evidence_summary: "Admin cleared manual review flag",
          raw_inputs: { source: "GolfReview", action: "clear_manual_review" },
          raw_outputs: payload,
        });
      toast.success("Manual review cleared");
      setCourses((prev) =>
        prev.map((c) => (c.id === courseId ? { ...c, ...payload } : c))
      );
    }
    setUpdating(null);
  };

  // ── Filtering ────────────────────────────────────────────────────────────────

  const filtered = courses.filter((c) => {
    const eff = effectiveStatus(c.verification_status);
    if (statusFilter === "all") {
      /* keep row */
    } else if (statusFilter === "review_queue") {
      if (!isReviewQueueCourse(c)) return false;
    } else if (eff !== statusFilter) {
      return false;
    }
    if (privateOnly && !isPrivateConcern(c)) return false;
    if (staleOnly && !isStale(c.last_verified_at)) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !c.name.toLowerCase().includes(q) &&
        !(c.city ?? "").toLowerCase().includes(q) &&
        !(c.state ?? "").toLowerCase().includes(q) &&
        !(c.metro ?? "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  // ── Counts ───────────────────────────────────────────────────────────────────

  const counts = STATUS_TABS.reduce<Record<string, number>>((acc, t) => {
    if (t.value === "all") acc[t.value] = courses.length;
    else if (t.value === "review_queue") {
      acc[t.value] = courses.filter(isReviewQueueCourse).length;
    } else {
      acc[t.value] = courses.filter((c) => effectiveStatus(c.verification_status) === t.value).length;
    }
    return acc;
  }, {});

  const privateCount = courses.filter(isPrivateConcern).length;
  const staleCount   = courses.filter((c) => isStale(c.last_verified_at)).length;

  // ── Guards ───────────────────────────────────────────────────────────────────

  if (authLoading || !adminChecked) {
    return <div className="container mx-auto px-4 py-16 text-center">Loading...</div>;
  }
  if (!isAdmin) return null;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold">Golf Course Review</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {courses.length} courses — {privateCount} flagged as private/likely-private — {staleCount} stale (&gt;{STALE_DAYS}d).
            Default tab is <strong className="text-foreground">Review queue</strong> (<span className="text-foreground">unreviewed</span> + <span className="text-foreground">needs review</span>). Use <strong>Unreviewed</strong> alone if you only want never-touched imports.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadCourses} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filter bar */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setStatusFilter(t.value)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === t.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 rounded-full px-1 text-[10px] ${statusFilter === t.value ? "bg-white/20" : "bg-muted-foreground/15"}`}>
                {counts[t.value]}
              </span>
            </button>
          ))}
        </div>

        {/* Private-only toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="private-filter"
            checked={privateOnly}
            onCheckedChange={setPrivateOnly}
          />
          <Label htmlFor="private-filter" className="text-xs cursor-pointer">
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="h-3 w-3 text-red-500" />
              Private only
              {privateCount > 0 && (
                <span className="rounded-full bg-red-100 px-1.5 text-[10px] text-red-700">{privateCount}</span>
              )}
            </span>
          </Label>
        </div>

        {/* Stale-only toggle */}
        <div className="flex items-center gap-2">
          <Switch
            id="stale-filter"
            checked={staleOnly}
            onCheckedChange={setStaleOnly}
          />
          <Label
            htmlFor="stale-filter"
            className="text-xs cursor-pointer"
            title={`Only shows rows with no verified timestamp or last verified more than ${STALE_DAYS} days ago — hides newer needs_review rows`}
          >
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3 text-orange-500" />
              Stale only
              {staleCount > 0 && (
                <span className="rounded-full bg-orange-100 px-1.5 text-[10px] text-orange-700">{staleCount}</span>
              )}
            </span>
          </Label>
        </div>

        {/* Search */}
        <Input
          placeholder="Search name, city, metro…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 max-w-[220px] text-xs"
        />
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">Loading courses…</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">No courses match this filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-medium">Course</th>
                <th className="px-3 py-2.5 text-left font-medium">Added</th>
                <th className="px-3 py-2.5 text-left font-medium">Location</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="px-3 py-2.5 text-left font-medium">Access Type</th>
                <th className="px-3 py-2.5 text-left font-medium">Name Signal</th>
                <th className="px-3 py-2.5 text-left font-medium">Last Verified</th>
                <th className="px-3 py-2.5 text-left font-medium">Excluded Reason</th>
                <th className="px-3 py-2.5 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((course) => {
                const isPrivate = isPrivateConcern(course);
                const isBusy = updating === course.id;
                return (
                  <tr
                    key={course.id}
                    className={`border-b border-border last:border-0 transition-colors ${
                      isPrivate ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-muted/30"
                    }`}
                  >
                    {/* Course name */}
                    <td className="max-w-[200px] px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {isPrivate && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-500" />}
                        <span className="truncate font-medium leading-tight">{course.name}</span>
                      </div>
                      <a
                        href={`https://www.google.com/search?q=${encodeURIComponent(course.name + " " + (course.city ?? "") + " golf course")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-2.5 w-2.5" /> Search
                      </a>
                    </td>

                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {course.created_at
                        ? new Date(course.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "—"}
                    </td>

                    {/* Location */}
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {[course.city, course.state].filter(Boolean).join(", ") || "—"}
                      {course.metro && (
                        <div className="text-[10px] opacity-60">{course.metro}</div>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-3 py-2.5">
                      <StatusBadge status={course.verification_status} />
                    </td>

                    {/* Access type */}
                    <td className="px-3 py-2.5">
                      <AccessBadge type={course.course_type} />
                    </td>

                    {/* Name signal */}
                    <td className="px-3 py-2.5">
                      <ConfidenceBadge confidence={course.public_access_confidence} />
                    </td>

                    {/* Last verified */}
                    <td className="px-3 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {course.last_verified_at
                        ? new Date(course.last_verified_at).toLocaleDateString("en-US", {
                            month: "short", day: "numeric", year: "numeric",
                          })
                        : "—"}
                      {isStale(course.last_verified_at) && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-orange-200 bg-orange-50 px-1 py-0.5 text-[10px] text-orange-700">
                          <Clock className="h-2.5 w-2.5" />
                          stale
                        </span>
                      )}
                    </td>

                    {/* Excluded reason */}
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {course.excluded_reason
                        ? EXCLUDE_REASONS.find((r) => r.value === course.excluded_reason)?.label ?? course.excluded_reason
                        : "—"}
                    </td>

                    {/* Actions */}
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {course.verification_status !== "verified" && (
                          <button
                            disabled={isBusy}
                            onClick={() => updateStatus(course.id, "verified")}
                            className="rounded border border-green-300 bg-green-50 px-2 py-0.5 text-xs text-green-800 hover:bg-green-100 disabled:opacity-50"
                          >
                            {isBusy ? "…" : "Verified"}
                          </button>
                        )}
                        {course.verification_status !== "needs_review" && (
                          <button
                            disabled={isBusy}
                            onClick={() => updateStatus(course.id, "needs_review")}
                            className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                          >
                            {isBusy ? "…" : "Needs Review"}
                          </button>
                        )}
                        {course.verification_status !== "excluded" && (
                          <button
                            disabled={isBusy}
                            onClick={() => {
                              setExcludeReason("private_club");
                              setExcludeTarget(course);
                            }}
                            className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs text-red-800 hover:bg-red-100 disabled:opacity-50"
                          >
                            {isBusy ? "…" : "Exclude"}
                          </button>
                        )}
                        {course.manual_review_needed && (
                          <button
                            disabled={isBusy}
                            onClick={() => clearManualReview(course.id)}
                            className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {isBusy ? "…" : "Clear Review"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Showing {filtered.length} of {courses.length} courses
        {privateOnly && ` · private/likely-private filter active`}
      </p>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Legend:</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-400"></span>verified — eligible for packages</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-400"></span>unreviewed — eligible, not confirmed</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400"></span>needs_review — blocked from packages</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-400"></span>excluded — permanently blocked</span>
        <span><ShieldAlert className="mr-1 inline h-3 w-3 text-red-500" />private or likely-private flag</span>
        <span><Clock className="mr-1 inline h-3 w-3 text-orange-500" />stale — not verified in &gt;{STALE_DAYS} days</span>
      </div>

      {/* Exclude confirmation dialog */}
      <Dialog open={!!excludeTarget} onOpenChange={(open) => { if (!open) setExcludeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exclude course</DialogTitle>
            <DialogDescription>
              <strong>{excludeTarget?.name}</strong> will be marked excluded and hidden from all packages and search results. This requires a clear reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="exclude-reason">Reason for exclusion</Label>
            <Select value={excludeReason} onValueChange={setExcludeReason}>
              <SelectTrigger id="exclude-reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXCLUDE_REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only exclude when you have confirmed the course does not accept public tee time bookings.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExcludeTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!!updating}
              onClick={() => excludeTarget && updateStatus(excludeTarget.id, "excluded", excludeReason)}
            >
              Confirm Exclude
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
