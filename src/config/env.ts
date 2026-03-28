import dotenv from "dotenv";

dotenv.config();

function toNum(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  port: toNum(process.env.PORT, 3000),
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  maxJobSteps: toNum(process.env.MAX_JOB_STEPS, 25),
  defaultJobTimeoutMs: toNum(process.env.JOB_TIMEOUT_MS, 120000),
  allowedDomains: (process.env.ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};
