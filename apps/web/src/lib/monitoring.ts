/**
 * monitoring.ts
 *
 * Central error monitoring setup using Sentry.
 * All configuration lives here — no other file needs to import from @sentry directly.
 *
 * Required environment variables (add to Vercel → Settings → Environment Variables):
 *   VITE_SENTRY_DSN       — Found in your Sentry project → Settings → Client Keys (DSN)
 *   VITE_APP_ENV          — "production" | "staging" | "development"  (optional, defaults to "development")
 *
 * If VITE_SENTRY_DSN is not set, monitoring is silently disabled.
 * This means local development works without any Sentry account.
 */

import * as Sentry from "@sentry/react";

// __EC_SENTRY_DSN__ and __EC_APP_ENV__ are injected at build time via vite.config.ts define.
// This bypasses Vite's import.meta.env replacement which doesn't pick up Vercel env vars
// when the build runs via `npm run build --prefix apps/web`.
declare const __EC_SENTRY_DSN__: string;
declare const __EC_APP_ENV__: string;
const DSN = (typeof __EC_SENTRY_DSN__ !== "undefined" ? __EC_SENTRY_DSN__ : "") || undefined;
const ENV = (typeof __EC_APP_ENV__ !== "undefined" ? __EC_APP_ENV__ : "") || import.meta.env.MODE || "development";
console.log("[monitoring] DSN present:", Boolean(DSN), "| DSN length:", DSN?.length ?? 0, "| ENV:", ENV);

/** Call this once, before React renders. Safe to call with no DSN — it becomes a no-op. */
export function initMonitoring(): void {
  if (!DSN) {
    if (import.meta.env.DEV) {
      console.info("[monitoring] VITE_SENTRY_DSN not set — error monitoring disabled in this environment.");
    }
    return;
  }

  Sentry.init({
    dsn: DSN,
    environment: ENV,

    // Capture 100% of errors, but only a sample of performance traces.
    // Tune tracesSampleRate down (e.g. 0.1) once you have real traffic.
    tracesSampleRate: ENV === "production" ? 0.2 : 1.0,

    // Capture the last 10 user actions before an error so you can replay what happened.
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.05,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        // Mask text and inputs by default to protect user privacy.
        maskAllText: true,
        blockAllMedia: false,
      }),
    ],

    // Don't send errors from browser extensions or third-party scripts.
    denyUrls: [
      /extensions\//i,
      /^chrome:\/\//i,
      /^moz-extension:\/\//i,
    ],

    beforeSend(event) {
      // Never send events in local development even if a DSN accidentally gets set.
      if (ENV === "development") return null;
      return event;
    },
  });
}

/**
 * Manually capture an error with optional context.
 * Use this in catch blocks where you want Sentry to record the error
 * but you're also handling it gracefully for the user.
 *
 * Example:
 *   captureError(err, { context: "itinerary-generation", itinerary_id: id });
 */
export function captureError(err: unknown, extras?: Record<string, unknown>): void {
  if (!DSN) return;
  Sentry.withScope((scope) => {
    if (extras) scope.setExtras(extras);
    Sentry.captureException(err);
  });
}

/**
 * Tag the current user so errors in Sentry are linked to their account.
 * Call this after a successful login.
 */
export function identifyUser(userId: string, email?: string): void {
  if (!DSN) return;
  Sentry.setUser({ id: userId, email });
}

/**
 * Clear the user tag on sign-out so errors after that point are anonymous.
 */
export function clearUser(): void {
  if (!DSN) return;
  Sentry.setUser(null);
}
