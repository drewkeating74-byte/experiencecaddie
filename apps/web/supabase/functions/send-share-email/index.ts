import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_RECIPIENTS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_URL_PROTOCOLS = ["https:", "http:"];

function isValidEmail(email: string): boolean {
  return typeof email === "string" && EMAIL_REGEX.test(email.trim());
}

function validateShareUrl(url: string): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let body: { share_url?: string; recipient_emails?: unknown; sender_name?: string } = {};
    try {
      const raw = await req.text();
      if (!raw?.trim()) {
        return new Response(JSON.stringify({ error: "Request body is empty" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      body = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const FROM_EMAIL = Deno.env.get("FROM_EMAIL");
    if (!RESEND_API_KEY || !FROM_EMAIL) {
      return new Response(
        JSON.stringify({ error: "Server misconfiguration: RESEND_API_KEY or FROM_EMAIL not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const shareUrl = validateShareUrl(body.share_url ?? "");
    if (!shareUrl) {
      return new Response(JSON.stringify({ error: "Invalid or missing share_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawEmails = Array.isArray(body.recipient_emails) ? body.recipient_emails : [];
    const recipientEmails = rawEmails
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0);

    if (recipientEmails.length === 0) {
      return new Response(JSON.stringify({ error: "No valid recipient_emails provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (recipientEmails.length > MAX_RECIPIENTS) {
      return new Response(
        JSON.stringify({ error: `Maximum ${MAX_RECIPIENTS} recipients allowed` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const invalidEmails = recipientEmails.filter((e) => !isValidEmail(e));
    if (invalidEmails.length > 0) {
      return new Response(
        JSON.stringify({ error: `Invalid email format: ${invalidEmails.slice(0, 3).join(", ")}${invalidEmails.length > 3 ? "..." : ""}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const senderName = typeof body.sender_name === "string" ? body.sender_name.trim().slice(0, 100) : null;
    const introText = senderName
      ? `${escapeHtml(senderName)} shared a golf + concert weekend itinerary with you. Check it out:`
      : "Someone shared a golf + concert weekend itinerary with you. Check it out:";

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; line-height: 1.5;">
  <p>${introText}</p>
  <p><a href="${escapeHtml(shareUrl)}" style="color: #2563eb;">View itinerary</a></p>
</body>
</html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: recipientEmails,
        subject: "Check out this golf + concert weekend",
        html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = "Failed to send email";
      try {
        const errJson = JSON.parse(errText);
        errMsg = errJson?.message || errJson?.error || errMsg;
      } catch { /* use default */ }
      console.error("Resend API error:", res.status, errText);
      return new Response(JSON.stringify({ error: errMsg }), {
        status: res.status >= 500 ? 502 : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-share-email error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
