import OpenAI from "openai";
import { env } from "../../config/env";

let cachedClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: env.openaiApiKey,
    });
  }
  return cachedClient;
}
