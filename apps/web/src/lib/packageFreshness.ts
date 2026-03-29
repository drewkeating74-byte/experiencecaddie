/**
 * Package inventory freshness — single source of truth for admin + public UI.
 *
 * Rules (plain English):
 * - Inactive: package is not published (`active` is false). It never appears on public pages.
 * - Expired: `expires_at` is in the past. Hidden from public; admin shows as Expired.
 * - Expiring soon: still bookable, but `expires_at` is within EXPIRING_SOON_DAYS (default 7).
 *   Use this to replace inventory before it drops off the site.
 * - Upcoming: active, not expired, not in the “expiring soon” window — normal live inventory.
 *
 * Public pages additionally require `active === true` and
 * (`expires_at` is null OR `expires_at` > now). That filter stays in queries;
 * use `isPublicPackageBookable` for the same check in code.
 */

export const EXPIRING_SOON_DAYS = 7;

export type PackageInventoryStatus =
  | "inactive"
  | "expired"
  | "expiring_soon"
  | "upcoming";

/** Minimal shape for status + sorting (extends Package / API rows). */
export interface PackageFreshnessInput {
  active?: boolean | null;
  expires_at?: string | null;
  created_at?: string;
  featured?: boolean | null;
  events?: { event_date?: string | null } | null;
  /** Optional explicit window (when stored on package row). */
  package_start_date?: string | null;
  package_end_date?: string | null;
}

export function getPackageInventoryStatus(
  pkg: PackageFreshnessInput,
  now: Date = new Date()
): PackageInventoryStatus {
  if (pkg.active === false) return "inactive";

  const t = now.getTime();
  const expMs = pkg.expires_at ? new Date(pkg.expires_at).getTime() : null;
  if (expMs !== null && !Number.isNaN(expMs) && expMs <= t) return "expired";

  if (expMs !== null && !Number.isNaN(expMs) && expMs > t) {
    const daysLeft = Math.ceil((expMs - t) / 86400000);
    if (daysLeft > 0 && daysLeft <= EXPIRING_SOON_DAYS) return "expiring_soon";
  }

  return "upcoming";
}

/** Matches typical public Supabase filter: active and unexpired. */
export function isPublicPackageBookable(
  pkg: PackageFreshnessInput,
  now: Date = new Date()
): boolean {
  if (pkg.active !== true) return false;
  if (!pkg.expires_at) return true;
  const exp = new Date(pkg.expires_at).getTime();
  return !Number.isNaN(exp) && exp > now.getTime();
}

export function daysUntilExpiration(
  pkg: Pick<PackageFreshnessInput, "expires_at">,
  now: Date = new Date()
): number | null {
  if (!pkg.expires_at) return null;
  const exp = new Date(pkg.expires_at).getTime();
  if (Number.isNaN(exp)) return null;
  return Math.ceil((exp - now.getTime()) / 86400000);
}

/** Operator-focused label for admin (not marketing copy). */
export function getAdminExpirationLabel(
  pkg: PackageFreshnessInput,
  now: Date = new Date()
): string {
  const status = getPackageInventoryStatus(pkg, now);
  if (status === "inactive") return "Inactive";
  if (status === "expired") return "Expired";
  const d = daysUntilExpiration(pkg, now);
  if (status === "expiring_soon" && d !== null && d >= 0) {
    return d === 0 ? "Expires today" : `Expires in ${d} day${d === 1 ? "" : "s"}`;
  }
  if (pkg.expires_at && d !== null && d > EXPIRING_SOON_DAYS) {
    return `Expires in ${d} days`;
  }
  return "Live";
}

function eventTime(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const t = new Date(iso.includes("T") ? iso : `${iso}T12:00:00`).getTime();
  return Number.isNaN(t) ? Infinity : t;
}

/** Featured packages first, then soonest concert date, then created_at. */
export function comparePublicFeaturedThenEvent<T extends PackageFreshnessInput & { created_at?: string }>(
  a: T,
  b: T
): number {
  const fa = a.featured ? 0 : 1;
  const fb = b.featured ? 0 : 1;
  if (fa !== fb) return fa - fb;
  const ea = eventTime(a.events?.event_date ?? undefined);
  const eb = eventTime(b.events?.event_date ?? undefined);
  if (ea !== eb) return ea - eb;
  const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
  const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
  return cb - ca;
}

/** Soonest event first; ties by featured, then created. */
export function comparePublicSoonestEventFirst<T extends PackageFreshnessInput & { created_at?: string }>(
  a: T,
  b: T
): number {
  const ea = eventTime(a.events?.event_date ?? undefined);
  const eb = eventTime(b.events?.event_date ?? undefined);
  if (ea !== eb) return ea - eb;
  const fa = a.featured ? 0 : 1;
  const fb = b.featured ? 0 : 1;
  if (fa !== fb) return fa - fb;
  const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
  const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
  return cb - ca;
}

/** Parse YYYY-MM-DD for comparisons (local noon to avoid TZ drift). */
export function parseYmd(ymd: string | null | undefined): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim())) return null;
  const d = new Date(ymd.trim() + "T12:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Suggested `expires_at` end-of-day ISO when operator picks an event date:
 * day after event + EXPIRING_SOON_DAYS buffer → actually user asked event + 2 days before.
 * Default: event date + 2 days at end of day (matches prior backfill behavior).
 */
export function suggestExpiresAtFromEventDate(eventYmd: string | null | undefined): string | null {
  const d = parseYmd(eventYmd ?? undefined);
  if (!d) return null;
  d.setDate(d.getDate() + 2);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}
