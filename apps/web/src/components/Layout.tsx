import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import ScrollToTop from "@/components/ScrollToTop";
import { useAuth } from "@/hooks/useAuth";
import {
  peekPostAuthReturn,
  clearPostAuthReturn,
  isSafeInternalReturnTarget,
} from "@/lib/postAuthReturn";

export default function Layout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // After Google OAuth, Supabase often lands on `/` with tokens in the hash. Recovery:
  // 1) `?ec_next=` on the OAuth redirect URL (works if sessionStorage was cleared on the round trip)
  // 2) localStorage + sessionStorage mirror from savePostAuthReturn()
  useEffect(() => {
    if (!user || loading) return;

    const params = new URLSearchParams(location.search);
    const ecNextRaw = params.get("ec_next");
    if (ecNextRaw) {
      let path = ecNextRaw;
      try {
        path = decodeURIComponent(ecNextRaw);
      } catch {
        /* keep raw */
      }
      if (!path.startsWith("/")) path = `/${path}`;

      if (isSafeInternalReturnTarget(path)) {
        clearPostAuthReturn();
        navigate(path, { replace: true });
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
    navigate(normalized, { replace: true });
  }, [user, loading, navigate, location.pathname, location.search]);

  return (
    <div className="flex min-h-screen flex-col">
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
