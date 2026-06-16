import { z } from "zod";

export const loomTranscriptRequestSchema = z.object({
  url: z
    .url()
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.hostname === "loom.com" || parsed.hostname.endsWith(".loom.com");
      } catch {
        return false;
      }
    }, "URL must point to loom.com"),
  email: z.email(),
  password: z.string().min(8),
  maxSteps: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(5000).max(900000).optional(),
  userAgent: z.string().min(3).optional(),
});

export type LoomTranscriptRequest = z.infer<typeof loomTranscriptRequestSchema>;

export function validateLoomTranscriptRequest(payload: unknown): LoomTranscriptRequest {
  return loomTranscriptRequestSchema.parse(payload);
}
