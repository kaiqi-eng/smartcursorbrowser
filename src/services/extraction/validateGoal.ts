import { env } from "../../config/env";
import type { ScrapeResult } from "../../types/job";
import { getOpenAIClient } from "../ai/openaiClient";

type GoalAssessment = NonNullable<ScrapeResult["goalAssessment"]>;

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
  parsedPosts: Array<{ title: string; content: string }>;
  extractedData?: Record<string, unknown>;
}): Promise<GoalAssessment | undefined> {
  if (!env.openaiApiKey || !params.goal.trim()) {
    return undefined;
  }

  const client = getOpenAIClient();
  try {
    const completion = (await client.chat.completions.create({
      model: env.openaiModel,
      messages: [
        {
          role: "system",
          content:
            "You are a strict extraction validator. Determine whether scraped output satisfies the user goal. Do not assume success. Be conservative.",
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              goal: params.goal,
              finalUrl: params.finalUrl,
              pageTitle: params.pageTitle,
              rawText: params.rawText.slice(0, 6000),
              parsedPosts: params.parsedPosts.slice(0, 20),
              extractedData: params.extractedData ?? {},
              instructions: {
                outputFormat:
                  "{meetsGoal:boolean, confidence:'low'|'medium'|'high', reason:string, missingRequirements:string[]}",
                policy:
                  "Set meetsGoal=false if required content is missing, or if page appears to be auth/wall/landing content instead of requested target data.",
              },
            },
            null,
            2,
          ),
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
    })) as { choices?: Array<{ message?: { content?: string | null } }> };

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return undefined;
    }

    return normalizeAssessment(JSON.parse(content));
  } catch {
    return undefined;
  }
}
