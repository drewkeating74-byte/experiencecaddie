import type { Request, Response } from "express";
import { buildHealth } from "../services/healthService.js";

export const getHealth = (_req: Request, res: Response) => {
  res.json(buildHealth());
};
