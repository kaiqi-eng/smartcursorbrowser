import { z } from "zod";

export const otterTranscriptRequestSchema = z.object({
  url: z
    .url()
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.hostname === "otter.ai" || parsed.hostname.endsWith(".otter.ai");
      } catch {
        return false;
      }
    }, "URL must point to otter.ai"),
  email: z.email(),
  password: z.string().min(8),
  maxSteps: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(5000).max(900000).optional(),
  userAgent: z.string().min(3).optional(),
});

export type OtterTranscriptRequest = z.infer<typeof otterTranscriptRequestSchema>;

export function validateOtterTranscriptRequest(payload: unknown): OtterTranscriptRequest {
  return otterTranscriptRequestSchema.parse(payload);
}
