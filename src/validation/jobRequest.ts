import { z } from "zod";
import type { ScrapeJobRequest } from "../types/job";

export const loginFieldSchema = z.object({
  name: z.string().min(1),
  selector: z.string().min(1).optional(),
  value: z.string(),
  secret: z.boolean().optional().default(false),
});

export const scrapeJobRequestSchema = z.object({
  url: z.url(),
  goal: z.string().min(5),
  extractionSchema: z.record(z.string(), z.string()).optional(),
  loginFields: z.array(loginFieldSchema).optional(),
  maxSteps: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(5000).max(900000).optional(),
  userAgent: z.string().min(3).optional(),
});

export function validateScrapeJobRequest(payload: unknown): ScrapeJobRequest {
  return scrapeJobRequestSchema.parse(payload);
}
