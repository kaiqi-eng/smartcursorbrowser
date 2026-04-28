import { env } from "../../config/env";
import type { ScrapeResult } from "../../types/job";
import { getOpenAIClient } from "../ai/openaiClient";
import { withTimeout } from "../../utils/timeout";

type GoalAssessment = NonNullable<ScrapeResult["goalAssessment"]>;
type GoalValidationPayload = NonNullable<ScrapeResult["validationPayload"]>;
const VALIDATION_HTML_MAX_CHARS = 100000;
const VALIDATION_TEXT_MAX_CHARS = 12000;

function makeHeadTailSnippet(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  const separator = "\n... middle truncated ...\n";
  const budget = Math.max(0, maxChars - separator.length);
  const headSize = Math.floor(budget / 2);
  const tailSize = budget - headSize;
  return `${content.slice(0, headSize)}${separator}${content.slice(-tailSize)}`;
}

function normalizeAssessment(value: unknown): GoalAssessment | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const meetsGoal = record.meetsGoal;
  const confidence = record.confidence;
  const reason = record.reason;
  const missingRequirements = record.missingRequirements;

  if (typeof meetsGoal !== "boolean" || typeof reason !== "string") {
    return undefined;
  }
  const normalizedConfidence: GoalAssessment["confidence"] =
    confidence === "low" || confidence === "medium" || confidence === "high" ? confidence : "low";
  const normalizedMissing = Array.isArray(missingRequirements)
    ? missingRequirements.filter((item): item is string => typeof item === "string")
    : [];

  return {
    meetsGoal,
    confidence: normalizedConfidence,
    reason,
    missingRequirements: normalizedMissing,
  };
}

export async function validateGoalAgainstExtraction(params: {
  goal: string;
  finalUrl: string;
  pageTitle: string;
  rawText: string;
  rawHtml?: string;
  parsedPosts: Array<{ timestamp: string; content: string }>;
  extractedData?: Record<string, unknown>;
}): Promise<GoalAssessment | undefined> {
  if (!env.openaiApiKey || !params.goal.trim()) {
    return undefined;
  }

  const payload = buildValidationPayload(params);
  const client = getOpenAIClient();
  try {
    const completion = (await withTimeout(
      client.chat.completions.create({
        model: env.openaiModel,
        messages: [
          {
            role: "system",
            content:
              "You are a strict extraction validator. Determine whether scraped output satisfies the user goal. Be conservative, but do not fail a feed extraction solely because post text is truncated or includes locked-content banners.",
          },
          {
            role: "user",
            content: JSON.stringify(payload, null, 2),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "goal_assessment",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                meetsGoal: { type: "boolean" },
                confidence: { type: "string", enum: ["low", "medium", "high"] },
                reason: { type: "string" },
                missingRequirements: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["meetsGoal", "confidence", "reason", "missingRequirements"],
            },
          },
        },
        max_tokens: 450,
      }),
      env.aiTimeoutMs,
      "goal validation",
    )) as { choices?: Array<{ message?: { content?: string | null } }> };

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return undefined;
    }
    return normalizeAssessment(JSON.parse(content));
  } catch {
    return undefined;
  }
}

export function buildValidationPayload(params: {
  goal: string;
  finalUrl: string;
  pageTitle: string;
  rawText: string;
  rawHtml?: string;
  parsedPosts: Array<{ timestamp: string; content: string }>;
  extractedData?: Record<string, unknown>;
}): GoalValidationPayload {
  return {
    goal: params.goal,
    finalUrl: params.finalUrl,
    pageTitle: params.pageTitle,
    rawText: makeHeadTailSnippet(params.rawText, VALIDATION_TEXT_MAX_CHARS),
    rawHtml: makeHeadTailSnippet(params.rawHtml ?? "", VALIDATION_HTML_MAX_CHARS),
    parsedPosts: params.parsedPosts.slice(0, 20),
    extractedData: params.extractedData ?? {},
    instructions: {
      outputFormat: "{meetsGoal:boolean, confidence:'low'|'medium'|'high', reason:string, missingRequirements:string[]}",
      policy:
        "Set meetsGoal=false if required content is missing, or if page appears to be auth/wall/landing content instead of requested target data. For feed goals, set meetsGoal=true when finalUrl/pageTitle indicate in-app feed access and parsedPosts contains a substantial set of timestamped posts (typically >=10), even if some post bodies are truncated or include locked-content upgrade prompts.",
      parsedPostsFormat:
        "Each parsed post is {timestamp, content}, where timestamp is a relative label like 1d/1h/30m and content is raw post text.",
    },
  };
}
