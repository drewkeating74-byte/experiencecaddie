import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { identifyUser, clearUser } from "@/lib/monitoring";

const OAUTH_PROVIDER_KEY = "oauth_provider";

const AUTH_TIMEOUT_MS = 5000;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);

  useEffect(() => {
    let mounted = true;

    const finishLoading = () => {
      if (mounted) setLoading(false);
    };

    const showOAuthSuccessToast = (provider: string) => {
      try {
        const label = provider === "google" ? "Google" : provider === "apple" ? "Apple" : provider;
        toast.success(`Signed in with ${label}`, { duration: 8000, position: "top-center" });
      } finally {
        sessionStorage.removeItem(OAUTH_PROVIDER_KEY);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        setSession(session);
        setUser(session?.user ?? null);
        finishLoading();

        if (session?.user) {
          identifyUser(session.user.id, session.user.email);
          const provider = sessionStorage.getItem(OAUTH_PROVIDER_KEY);
          if (provider) showOAuthSuccessToast(provider);
          Promise.resolve(supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", session.user.id)
            .eq("role", "admin")
            .maybeSingle())
            .then(({ data }) => {
              if (!mounted) return;
              setIsAdmin(!!data);
              setAdminChecked(true);
            })
            .catch((err: unknown) => {
              console.error("Failed to check admin role:", err);
              if (mounted) setAdminChecked(true);
            });
        } else {
          clearUser();
          if (mounted) {
            setIsAdmin(false);
            setAdminChecked(true);
          }
        }
      }
    );

    const timeoutId = setTimeout(finishLoading, AUTH_TIMEOUT_MS);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      finishLoading();
      clearTimeout(timeoutId);
      if (session?.user) {
        identifyUser(session.user.id, session.user.email);
        const provider = sessionStorage.getItem(OAUTH_PROVIDER_KEY);
        if (provider) showOAuthSuccessToast(provider);
        Promise.resolve(supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id)
          .eq("role", "admin")
          .maybeSingle())
          .then(({ data }) => { if (mounted) { setIsAdmin(!!data); setAdminChecked(true); } })
          .catch((err: unknown) => { console.error("Failed to check admin role:", err); if (mounted) setAdminChecked(true); });
      } else {
        if (mounted) setAdminChecked(true);
      }
    }).catch(() => {
      finishLoading();
      clearTimeout(timeoutId);
    });

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    setSession(null);
    setUser(null);
    setIsAdmin(false);
    clearUser(); // Remove user tag from Sentry so post-logout errors are anonymous.
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
    } catch {
      const url = import.meta.env.VITE_SUPABASE_URL ?? "";
      const projectRef = url.includes("supabase.co") ? new URL(url).hostname.split(".")[0] : null;
      if (projectRef) {
        try {
          const key = `${projectRef}-auth-token`;
          localStorage.removeItem(key);
        } catch {}
      }
    }
  };

  return { user, session, loading, isAdmin, adminChecked, signOut };
}
