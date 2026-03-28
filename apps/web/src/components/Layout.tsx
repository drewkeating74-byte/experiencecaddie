import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import ScrollToTop from "@/components/ScrollToTop";
import { useAuth } from "@/hooks/useAuth";

export default function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // After OAuth sign-in, Supabase sometimes redirects to the site root instead of
  // the intended deep-link. We save the target path to sessionStorage before the
  // OAuth redirect in Auth.tsx and recover it here once the user is authenticated.
  useEffect(() => {
    if (!user) return;
    const pending = sessionStorage.getItem("post_auth_redirect");
    if (pending) {
      sessionStorage.removeItem("post_auth_redirect");
      navigate(pending, { replace: true });
    }
  }, [user, navigate]);

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
