/**
 * Return path after sign-in (especially Google OAuth).
 * Mirrors to localStorage + sessionStorage; OAuth redirect can also carry ?ec_next=…
 * so we recover even if sessionStorage is cleared on the round trip.
 */

const SESSION_KEY = "post_auth_redirect";
const LOCAL_KEY = "ec_post_auth_redirect";

export function savePostAuthReturn(pathWithSearch: string): void {
  const t = pathWithSearch.trim();
  if (!t || t === "/") return;
  try {
    sessionStorage.setItem(SESSION_KEY, t);
    localStorage.setItem(LOCAL_KEY, t);
  } catch {
    /* ignore quota / private mode */
  }
}

export function peekPostAuthReturn(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(LOCAL_KEY);
  } catch {
    return null;
  }
}

export function clearPostAuthReturn(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

/** Path (+ optional ?query) only — blocks open redirects. */
export function isSafeInternalReturnTarget(path: string): boolean {
  const pathname = path.split("?")[0] || "";
  if (!pathname || pathname === "/") return false;
  if (!pathname.startsWith("/")) return false;
  if (pathname.startsWith("//")) return false;
  if (pathname.includes("://")) return false;
  return true;
}

/** OAuth redirect target: always same origin; adds ec_next when we need a deep return. */
export function buildOAuthRedirectUrl(origin: string, returnPath: string): string {
  const r = returnPath.trim();
  if (!r || r === "/") return `${origin.replace(/\/$/, "")}/`;
  const enc = encodeURIComponent(r.startsWith("/") ? r : `/${r}`);
  return `${origin.replace(/\/$/, "")}/?ec_next=${enc}`;
}
