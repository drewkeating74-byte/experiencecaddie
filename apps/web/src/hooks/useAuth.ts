import { useState, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

const OAUTH_PROVIDER_KEY = "oauth_provider";

const AUTH_TIMEOUT_MS = 5000;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

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
        setIsAdmin(false);
        finishLoading();

        if (session?.user) {
          const provider = sessionStorage.getItem(OAUTH_PROVIDER_KEY);
          if (provider) showOAuthSuccessToast(provider);
          Promise.resolve(supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", session.user.id)
            .eq("role", "admin")
            .maybeSingle())
            .then(({ data }: any) => mounted && setIsAdmin(!!data))
            .catch(() => {});
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
        const provider = sessionStorage.getItem(OAUTH_PROVIDER_KEY);
        if (provider) showOAuthSuccessToast(provider);
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id)
          .eq("role", "admin")
          .maybeSingle()
          .then(({ data }: any) => mounted && setIsAdmin(!!data))
          .catch(() => {});
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

  return { user, session, loading, isAdmin, signOut };
}
