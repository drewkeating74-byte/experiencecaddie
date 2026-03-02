import type { Request, Response } from "express";
import { buildSearchResponse } from "../services/searchService.js";
import type { SearchRequest } from "../contracts/search.js";

const parseRequest = (req: Request): SearchRequest => {
  const body = (req.body || {}) as Partial<SearchRequest>;
  const query = req.query as Record<string, unknown>;
  const getString = (value: unknown) => (typeof value === "string" ? value : undefined);
  const getNumber = (value: unknown) => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) return Number(value);
    return undefined;
  };

  const city = body.destination?.city || getString(query.city) || "Austin";
  const state = body.destination?.state || getString(query.state);
  const lat = body.destination?.lat ?? getNumber(query.lat);
  const lng = body.destination?.lng ?? getNumber(query.lng);
  const startDate = body.dates?.start_date || getString(query.start_date) || getString(query.startDate);
  const endDate = body.dates?.end_date || getString(query.end_date) || getString(query.endDate);
  const teeTimeStart = getString(query.tee_time_start);
  const teeTimeEnd = getString(query.tee_time_end);

  return {
    destination: {
      city,
      state,
      lat,
      lng,
    },
    dates: {
      start_date: startDate || new Date().toISOString().split("T")[0],
      end_date:
        endDate || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    },
    group_size: body.group_size ?? getNumber(query.group_size) ?? getNumber(query.groupSize),
    budget_tier: body.budget_tier ?? body.budgetTier,
    tee_time_window:
      body.tee_time_window ??
      body.teeTimeWindow ??
      (teeTimeStart || teeTimeEnd ? { start: teeTimeStart || "07:00", end: teeTimeEnd || "11:00" } : undefined),
  };
};

export const searchAll = (req: Request, res: Response) => {
  const payload = parseRequest(req);
  res.json(buildSearchResponse(payload));
};

export const searchEvents = (req: Request, res: Response) => {
  const payload = parseRequest(req);
  const response = buildSearchResponse(payload);
  res.json({ ...response, golf_courses: [], hotels: [], itinerary: undefined });
};

export const searchGolf = (req: Request, res: Response) => {
  const payload = parseRequest(req);
  const response = buildSearchResponse(payload);
  res.json({ ...response, events: [], hotels: [], itinerary: undefined });
};

export const searchHotels = (req: Request, res: Response) => {
  const payload = parseRequest(req);
  const response = buildSearchResponse(payload);
  res.json({ ...response, events: [], golf_courses: [], itinerary: undefined });
};
