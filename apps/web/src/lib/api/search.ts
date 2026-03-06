export type SearchRequest = {
  artist?: string;
  destination: { city?: string; state?: string };
  dates: { start_date: string; end_date: string };
  group_size?: number;
  budget_tier?: "low" | "mid" | "high";
};

export type SearchResponse = {
  destination: { city: string; state?: string; start_date: string; end_date: string };
  events: Array<{
    id: string;
    name: string;
    date_time: string;
    venue: { name: string; city: string; state?: string };
    image_url?: string;
    book_url?: string;
    price_min?: number;
    price_max?: number;
    provider: string;
  }>;
  golf_courses: Array<{
    id: string;
    name: string;
    city: string;
    state?: string;
    book_url?: string;
    provider: string;
  }>;
  hotels: Array<{
    id: string;
    name: string;
    city: string;
    state?: string;
    book_url?: string;
    provider: string;
  }>;
};

function getApiBase(): string | undefined {
  const url = import.meta.env.VITE_API_BASE_URL;
  return typeof url === "string" && url.trim() ? url.replace(/\/$/, "") : undefined;
}

export async function fetchSearch(request: SearchRequest): Promise<SearchResponse | null> {
  const base = getApiBase();
  if (!base) return null;

  const params = new URLSearchParams({
    start_date: request.dates.start_date,
    end_date: request.dates.end_date,
  });
  if (request.artist?.trim()) params.set("artist", request.artist.trim());
  if (request.destination?.city) params.set("city", request.destination.city);
  if (request.destination?.state) params.set("state", request.destination.state);
  if (request.group_size != null) params.set("group_size", String(request.group_size));
  if (request.budget_tier) params.set("budget_tier", request.budget_tier);

  try {
    const res = await fetch(`${base}/api/search?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
