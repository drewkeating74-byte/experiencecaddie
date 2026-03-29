import { useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import Navbar from "@/components/Navbar";
import ScrollToTop from "@/components/ScrollToTop";
import { useAuth } from "@/hooks/useAuth";

export default function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // After OAuth sign-in, Supabase sometimes redirects to `/` instead of the deep link.
  // `post_auth_redirect` is set when requiring login (ItineraryResults) and when Auth loads / Google OAuth starts.
  useEffect(() => {
    if (!user) return;
    const pending = sessionStorage.getItem("post_auth_redirect");
    if (!pending) return;

    const normalized = pending.startsWith("/") ? pending : `/${pending}`;
    const here = `${location.pathname}${location.search}`;
    const pendingPath = normalized.split("?")[0];
    if (here === normalized || location.pathname === pendingPath) {
      sessionStorage.removeItem("post_auth_redirect");
      return;
    }

    sessionStorage.removeItem("post_auth_redirect");
    navigate(normalized, { replace: true });
  }, [user, navigate, location.pathname, location.search]);

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
