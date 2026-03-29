/** Empty string → null; otherwise valid http(s) URL, auto-prepending https:// when missing. */
export function normalizeOptionalHttpUrl(
  raw: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const t = raw.trim();
  if (!t) return { ok: true, value: null };
  const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, message: "URL must use http:// or https://" };
    }
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false, message: "Invalid URL" };
  }
}
