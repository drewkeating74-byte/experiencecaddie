import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import ScrollToTop from "@/components/ScrollToTop";
import { useAuth } from "@/hooks/useAuth";
import {
  peekPostAuthReturn,
  clearPostAuthReturn,
  isSafeInternalReturnTarget,
  decodeEcNextParam,
} from "@/lib/postAuthReturn";

// Show a banner in every non-production environment (staging preview, local dev).
// In production, VITE_APP_ENV is explicitly set to "production" in Vercel env vars.
// In Vercel Preview deployments, set VITE_APP_ENV=staging.
const APP_ENV = import.meta.env.VITE_APP_ENV as string | undefined;
const showStagingBanner = APP_ENV !== "production";

function StagingBanner() {
  if (!showStagingBanner) return null;
  const label = APP_ENV === "staging" ? "STAGING" : "DEV";
  return (
    <div
      role="banner"
      aria-label="Staging environment notice"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-400 px-3 py-1 text-xs font-semibold text-amber-950"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-amber-700" aria-hidden="true" />
      {label} — not production · data may be incomplete or synthetic
    </div>
  );
}

export default function Layout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // After Google OAuth, Supabase often lands on `/` with tokens in the hash. Recovery:
  // 1) `?ec_next=` on the OAuth redirect URL (works if sessionStorage was cleared on the round trip)
  // 2) localStorage + sessionStorage mirror from savePostAuthReturn()
  useEffect(() => {
    if (loading || !user) return;

    const hardGo = (path: string) => {
      const p = path.startsWith("/") ? path : `/${path}`;
      window.location.replace(`${window.location.origin}${p}`);
    };

    const params = new URLSearchParams(location.search);
    const ecNextRaw = params.get("ec_next");
    if (ecNextRaw) {
      let path = decodeEcNextParam(ecNextRaw);
      if (!path.startsWith("/")) path = `/${path}`;

      if (isSafeInternalReturnTarget(path)) {
        clearPostAuthReturn();
        hardGo(path);
        return;
      }

      params.delete("ec_next");
      const qs = params.toString();
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : "" }, { replace: true });
      return;
    }

    const pending = peekPostAuthReturn();
    if (!pending) return;

    const normalized = pending.startsWith("/") ? pending : `/${pending}`;
    const here = `${location.pathname}${location.search}`;
    const pendingPath = normalized.split("?")[0];
    if (here === normalized || location.pathname === pendingPath) {
      clearPostAuthReturn();
      return;
    }

    clearPostAuthReturn();
    hardGo(normalized);
  }, [user, loading, navigate, location.pathname, location.search]);

  return (
    <div className="flex min-h-screen flex-col">
      <StagingBanner />
      <ScrollToTop />
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border bg-muted/30 py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="font-serif text-lg font-semibold text-primary">Experience Caddie</p>
          <p className="mt-1 text-sm text-muted-foreground">Legendary Weekends. Zero Planning.</p>
          <p className="mt-4 text-xs text-muted-foreground">© {new Date().getFullYear()} Fairway & Encore. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
