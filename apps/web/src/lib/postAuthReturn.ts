/**
 * Return path after sign-in (especially Google OAuth).
 * sessionStorage + localStorage + short-lived cookie (helps with some OAuth / www quirks).
 * URL may also carry ?ec_next=…
 */

const SESSION_KEY = "post_auth_redirect";
const LOCAL_KEY = "ec_post_auth_redirect";
const COOKIE_NAME = "ec_post_auth_return";

function setReturnCookie(pathWithSearch: string): void {
  try {
    const enc = encodeURIComponent(pathWithSearch);
    document.cookie = `${COOKIE_NAME}=${enc}; path=/; max-age=600; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

function readReturnCookie(): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`));
    if (!m?.[1]) return null;
    return decodeURIComponent(m[1].trim());
  } catch {
    return null;
  }
}

function clearReturnCookie(): void {
  try {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
  } catch {
    /* ignore */
  }
}

export function savePostAuthReturn(pathWithSearch: string): void {
  const t = pathWithSearch.trim();
  if (!t || t === "/") return;
  try {
    sessionStorage.setItem(SESSION_KEY, t);
    localStorage.setItem(LOCAL_KEY, t);
    setReturnCookie(t);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Visiting /auth without a return path — clear stale saved targets */
export function clearPostAuthReturnIfHomeOnly(redirectPath: string): void {
  const t = redirectPath.trim();
  if (t && t !== "/") return;
  clearPostAuthReturn();
}

export function peekPostAuthReturn(): string | null {
  try {
    return (
      sessionStorage.getItem(SESSION_KEY) ??
      localStorage.getItem(LOCAL_KEY) ??
      readReturnCookie()
    );
  } catch {
    return readReturnCookie();
  }
}

export function clearPostAuthReturn(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LOCAL_KEY);
    clearReturnCookie();
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

/** ec_next may be double-encoded depending on redirect chain */
export function decodeEcNextParam(raw: string): string {
  let s = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  return s;
}
