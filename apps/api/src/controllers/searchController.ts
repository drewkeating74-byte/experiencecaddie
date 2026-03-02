import type { Request, Response } from "express";
import { buildSearchResponse } from "../services/searchService.js";
import type { SearchRequest } from "../contracts/search.js";

const parseRequest = (req: Request): SearchRequest => {
  const body = (req.body || {}) as Partial<SearchRequest>;
  return {
    destination: {
      city: body.destination?.city || "Austin",
      state: body.destination?.state,
      lat: body.destination?.lat,
      lng: body.destination?.lng,
    },
    dates: {
      startDate: body.dates?.startDate || new Date().toISOString().split("T")[0],
      endDate:
        body.dates?.endDate ||
        new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    },
    groupSize: body.groupSize,
    budgetTier: body.budgetTier,
    teeTimeWindow: body.teeTimeWindow,
  };
};

export const searchAll = (req: Request, res: Response) => {
  const payload = parseRequest(req);
  res.json(buildSearchResponse(payload));
};

export const searchEvents = (req: Request, res: Response) => {
  const payload = parseRequest(req);
  const response = buildSearchResponse(payload);
  res.json({ ...response, golfCourses: [], hotels: [], itinerary: undefined });
};

export const searchGolf = (req: Request, res: Response) => {
  const payload = parseRequest(req);
  const response = buildSearchResponse(payload);
  res.json({ ...response, events: [], hotels: [], itinerary: undefined });
};

export const searchHotels = (req: Request, res: Response) => {
  const payload = parseRequest(req);
  const response = buildSearchResponse(payload);
  res.json({ ...response, events: [], golfCourses: [], itinerary: undefined });
};
