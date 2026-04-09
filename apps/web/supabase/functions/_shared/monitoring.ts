/**
 * _shared/monitoring.ts
 *
 * Lightweight error reporting for Supabase Edge Functions (Deno runtime).
 * Does two things on every error:
 *   1. Logs structured JSON to console.error → visible in Supabase Dashboard → Logs.
 *   2. Sends the error to Sentry via their HTTP API (no SDK needed).
 *
 * Also exports logProviderError() to write structured rows to the provider_errors
 * table for Ticketmaster and Google Places failures — used for daily health checks.
 *
 * Required Supabase Edge Function secret:
 *   SENTRY_DSN  — same DSN you use on the frontend (sentry.io → Project → Settings → Client Keys)
 *
 * Optional:
 *   APP_ENV     — "production" | "staging" (defaults to "production")
 *
 * If SENTRY_DSN is not set, only the console.error log fires. Safe to deploy without it.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Provider error logging — writes to the provider_errors table so we can
// run a daily SQL query to check Ticketmaster / Google Places health.
// ---------------------------------------------------------------------------

/**
 * Log a provider API failure to the provider_errors table.
 * Fire-and-forget: never throws, never blocks the calling function's response.
 *
 * @param provider     - 'ticketmaster' | 'google_places'
 * @param statusCode   - HTTP status from the provider, or null for network errors
 * @param errorMessage - Short description (exception message or response snippet)
 * @param functionName - Name of the calling edge function, e.g. 'search'
 */
export async function logProviderError(
  provider: string,
  statusCode: number | null,
  errorMessage: string,
  functionName: string,
): Promise<void> {
  const rateLimited = statusCode === 429;
  console.error(
    "[provider-error]",
    JSON.stringify({ provider, status_code: statusCode, rate_limited: rateLimited, error_message: errorMessage, function_name: functionName }),
  );
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseKey) return;
  try {
    const sb = createClient(supabaseUrl, supabaseKey);
    await sb.from("provider_errors").insert({
      provider,
      status_code: statusCode,
      rate_limited: rateLimited,
      error_message: errorMessage.slice(0, 500),
      function_name: functionName,
    });
  } catch {
    // Never let DB logging failures surface to callers.
  }
}

interface SentryConfig {
  publicKey: string;
  host: string;
  projectId: string;
}

/** Parse a Sentry DSN URL into its component parts. Returns null if invalid. */
function parseDsn(dsn: string): SentryConfig | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const host = url.host;
    const projectId = url.pathname.replace(/^\//, "");
    if (!publicKey || !host || !projectId) return null;
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

/** Convert a JS stack trace string into Sentry's frame format. */
function parseStack(
  stack: string,
): Array<{ filename: string; function: string; lineno?: number }> {
  return stack
    .split("\n")
    .slice(1)
    .map((line) => {
      const m = line.trim().match(/at (.+?) \((.+?):(\d+):\d+\)/);
      if (m) return { function: m[1], filename: m[2], lineno: parseInt(m[3]) };
      return { filename: "edge-function", function: line.trim() };
    })
    .filter((f) => f.function.length > 0);
}

/**
 * Report an error from an Edge Function.
 *
 * Usage:
 *   import { reportError } from "../_shared/monitoring.ts";
 *
 *   } catch (err) {
 *     await reportError(err, { function: "generate-itinerary", itinerary_id });
 *     return new Response(...);
 *   }
 */
export async function reportError(
  err: unknown,
  context?: Record<string, unknown>,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? "") : "";
  const name = err instanceof Error ? err.name : "Error";

  // 1. Always write to Supabase function logs (visible in Dashboard → Edge Functions → Logs).
  console.error(
    "[edge-error]",
    JSON.stringify({ message, name, ...context }),
  );

  // 2. Send to Sentry if DSN is configured.
  const dsn = Deno.env.get("SENTRY_DSN");
  if (!dsn) return;

  const config = parseDsn(dsn);
  if (!config) {
    console.warn("[monitoring] SENTRY_DSN is set but could not be parsed. Check the value.");
    return;
  }

  const environment = Deno.env.get("APP_ENV") ?? "production";

  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    environment,
    exception: {
      values: [
        {
          type: name,
          value: message,
          stacktrace: stack ? { frames: parseStack(stack) } : undefined,
        },
      ],
    },
    extra: context,
    tags: {
      runtime: "deno-edge",
    },
  };

  try {
    const res = await fetch(
      `https://${config.host}/api/${config.projectId}/store/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${config.publicKey}`,
        },
        body: JSON.stringify(event),
      },
    );
    if (!res.ok && environment !== "production") {
      console.warn("[monitoring] Sentry rejected event:", res.status, await res.text());
    }
  } catch {
    // Never let a monitoring failure affect the function's own error response.
  }
}
