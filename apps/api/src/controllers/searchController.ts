import type { Request, Response } from "express";
import { buildSearchResponse } from "../services/searchService.js";
import type { SearchRequest } from "../contracts/search.js";

function parseRequest(req: Request): SearchRequest {
  const body = (req.body || {}) as Record<string, unknown>;
  const query = req.query as Record<string, unknown>;
  const getString = (v: unknown) => (typeof v === "string" ? v : undefined);
  const getNumber = (v: unknown) => {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim()) return Number(v);
    return undefined;
  };

  const dest = body.destination as Record<string, unknown> | undefined;
  const dates = body.dates as Record<string, unknown> | undefined;
  const artist = getString(body.artist) ?? getString(query.artist) ?? getString(query.keyword);
  const city = getString(dest?.city) ?? getString(query.city);
  const state = getString(dest?.state) ?? getString(query.state);
  const lat = getNumber(dest?.lat) ?? getNumber(query.lat);
  const lng = getNumber(dest?.lng) ?? getNumber(query.lng);
  const startDate = getString(dates?.start_date) ?? getString(query.start_date) ?? getString(query.startDate);
  const endDate = getString(dates?.end_date) ?? getString(query.end_date) ?? getString(query.endDate);
  const teeTimeStart = getString(query.tee_time_start);
  const teeTimeEnd = getString(query.tee_time_end);
  const rawBudget = getString(body.budget_tier) ?? getString(body.budgetTier) ?? getString(query.budget_tier) ?? getString(query.budgetTier);
  const budget_tier = rawBudget === "low" || rawBudget === "mid" || rawBudget === "high" ? rawBudget : undefined;

  return {
    artist: artist || undefined,
    destination: { city, state, lat, lng },
    dates: {
      start_date: startDate ?? new Date().toISOString().split("T")[0],
      end_date: endDate ?? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    },
    group_size: getNumber(body.group_size) ?? getNumber(query.group_size) ?? getNumber(query.groupSize),
    budget_tier,
    tee_time_window: (() => {
      const tw = body.tee_time_window ?? body.teeTimeWindow;
      if (tw && typeof tw === "object" && "start" in tw && "end" in tw) return { start: String(tw.start), end: String(tw.end) };
      return teeTimeStart || teeTimeEnd ? { start: teeTimeStart ?? "07:00", end: teeTimeEnd ?? "11:00" } : undefined;
    })(),
  };
}

export async function searchAll(req: Request, res: Response): Promise<void> {
  try {
    const payload = parseRequest(req);
    const response = await buildSearchResponse(payload);
    res.json(response);
  } catch (err) {
    console.error("[searchController] error:", err);
    res.status(500).json({ error: "Search failed" });
  }
}
