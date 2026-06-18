import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE = "https://experiencecaddie.com";

const STATIC_PAGES = [
  { loc: `${SITE}/`, priority: "1.0", changefreq: "daily" },
  { loc: `${SITE}/packages`, priority: "0.9", changefreq: "daily" },
  { loc: `${SITE}/experience`, priority: "0.9", changefreq: "weekly" },
  { loc: `${SITE}/privacy`, priority: "0.3", changefreq: "monthly" },
  { loc: `${SITE}/terms`, priority: "0.3", changefreq: "monthly" },
] as const;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(loc: string, priority: string, changefreq: string): string {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    return new Response("Server configuration error", { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const nowIso = new Date().toISOString();

  const { data: packages, error } = await supabase
    .from("packages")
    .select("id, updated_at")
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

  if (error) {
    console.error("[generate-sitemap] query error:", error.message);
    return new Response("Failed to generate sitemap", { status: 500 });
  }

  const entries = [
    ...STATIC_PAGES.map((page) => urlEntry(page.loc, page.priority, page.changefreq)),
    ...(packages ?? []).map((pkg) =>
      urlEntry(`${SITE}/packages/${pkg.id}`, "0.7", "weekly")
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>`;

  const headers = {
    "Content-Type": "application/xml",
    "Cache-Control": "public, max-age=3600",
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(xml, { status: 200, headers });
});
