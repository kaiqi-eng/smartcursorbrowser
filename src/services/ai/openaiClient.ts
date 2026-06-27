import OpenAI from "openai";
import { env } from "../../config/env";

let cachedClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  if (!cachedClient) {
    const defaultHeaders: Record<string, string> = {};
    if (env.openrouterHttpReferer) {
      defaultHeaders["HTTP-Referer"] = env.openrouterHttpReferer;
    }
    if (env.openrouterAppTitle) {
      defaultHeaders["X-Title"] = env.openrouterAppTitle;
    }

    cachedClient = new OpenAI({
      apiKey: env.openaiApiKey,
      baseURL: env.openaiBaseUrl || undefined,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    });
  }
  return cachedClient;
}
