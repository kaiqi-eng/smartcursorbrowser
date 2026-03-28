import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

export const API_KEY_HEADER = "x-api-key";

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.serviceApiKey) {
    res.status(500).json({
      error: "SERVICE_API_KEY is not configured on server.",
    });
    return;
  }

  const provided = req.header(API_KEY_HEADER);
  if (!provided || provided !== env.serviceApiKey) {
    res.status(401).json({
      error: `Missing or invalid API key. Provide header '${API_KEY_HEADER}'.`,
    });
    return;
  }

  next();
}
