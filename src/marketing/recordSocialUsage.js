/**
 * Record an approved social post so the review tool can flag reused variants.
 * Uses Supabase service-role REST (bypasses RLS).
 */
export async function recordSocialUsage({
  supabaseUrl,
  serviceKey,
  templateType,
  variantKey,
  label = null,
  imageUrl = null,
  caption = null,
  bufferPostId = null,
  usedAt = null,
  metadata = {},
}) {
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase URL and service role key are required to record usage");
  }
  if (!templateType || !variantKey) {
    throw new Error("templateType and variantKey are required");
  }

  const row = {
    template_type: templateType,
    variant_key: String(variantKey),
    label: label || null,
    image_url: imageUrl || null,
    caption: caption || null,
    buffer_post_id: bufferPostId || null,
    used_at: (usedAt instanceof Date ? usedAt : usedAt ? new Date(usedAt) : new Date()).toISOString(),
    metadata,
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/social_post_usage`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    throw new Error(`social_post_usage insert failed: ${await res.text()}`);
  }

  return res.json();
}

export function formatUsedDate(isoOrDate) {
  if (!isoOrDate) return null;
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
