const UTM_STORAGE_KEY = "experiencecaddie.utms";

export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmParams = Partial<Record<UtmKey, string>>;

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function captureUtmParams(search = typeof window !== "undefined" ? window.location.search : ""): UtmParams {
  const params = new URLSearchParams(search);
  const captured: UtmParams = {};

  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) captured[key] = value.slice(0, 200);
  }

  if (Object.keys(captured).length > 0 && canUseSessionStorage()) {
    window.sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(captured));
  }

  return captured;
}

export function getStoredUtmParams(): UtmParams {
  if (!canUseSessionStorage()) return {};

  try {
    const raw = window.sessionStorage.getItem(UTM_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const utms: UtmParams = {};
    for (const key of UTM_KEYS) {
      if (typeof parsed[key] === "string" && parsed[key].trim()) {
        utms[key] = parsed[key].trim().slice(0, 200);
      }
    }
    return utms;
  } catch {
    return {};
  }
}
