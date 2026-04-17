import dotenv from "dotenv";

dotenv.config();

function toNum(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.trim().toLowerCase() === "true";
}

export const env = {
  port: toNum(process.env.PORT, 3000),
  serviceApiKey: process.env.SERVICE_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  maxJobSteps: toNum(process.env.MAX_JOB_STEPS, 25),
  defaultJobTimeoutMs: toNum(process.env.JOB_TIMEOUT_MS, 120000),
  browserHeadless: toBool(process.env.BROWSER_HEADLESS, true),

  // Memory optimization flags (safe defaults)
  enableLiveScreenshots: toBool(process.env.ENABLE_LIVE_SCREENSHOTS, false),
  screenshotEveryNSteps: Math.max(1, toNum(process.env.SCREENSHOT_EVERY_N_STEPS, 4)),
  maxTraceEvents: Math.max(10, toNum(process.env.MAX_TRACE_EVENTS, 30)),
  maxRawTextChars: Math.max(2000, toNum(process.env.MAX_RAW_TEXT_CHARS, 15000)),
  finishedJobTtlMs: Math.max(60_000, toNum(process.env.FINISHED_JOB_TTL_MS, 10 * 60 * 1000)),
  cleanupIntervalMs: Math.max(30_000, toNum(process.env.CLEANUP_INTERVAL_MS, 60_000)),
  blockHeavyResources: toBool(process.env.BLOCK_HEAVY_RESOURCES, true),

  // Oxylabs fallback credentials — use OXYLABS_USERNAME / OXYLABS_PASSWORD in .env
  oxylabsUsername: process.env.OXYLABS_USERNAME ?? "",
  oxylabsPassword: process.env.OXYLABS_PASSWORD ?? "",

  allowedDomains: (process.env.ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};
