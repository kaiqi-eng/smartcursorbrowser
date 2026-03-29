import { env } from "../../config/env";
import { getOpenAIClient } from "../ai/openaiClient";

interface ParsedPost {
  title: string;
  content: string;
}

function coercePosts(value: unknown): ParsedPost[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const title = typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title.trim() : "";
      const content =
        typeof (item as { content?: unknown }).content === "string" ? (item as { content: string }).content.trim() : "";
      if (!title && !content) {
        return null;
      }
      return { title, content };
    })
    .filter((item): item is ParsedPost => item !== null);
}

export async function parsePostsFromRawText(rawText: string, goal: string): Promise<ParsedPost[]> {
  if (!rawText.trim() || !env.openaiApiKey) {
    return [];
  }

  const client = getOpenAIClient();
  const response = (await client.responses.create({
    model: env.openaiModel,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Extract post-like entries from provided website text and return JSON only. Use exact wording from source as much as possible. Do not paraphrase unless absolutely needed for clarity.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Return a JSON array where each item has exactly:",
              '{ "title": "...", "content": "..." }',
              "Rules:",
              "- Keep title/content as close to source text as possible (minimal adjustments).",
              "- If a title is missing, set title to empty string.",
              "- If there are no clear posts, return []",
              `Goal context: ${goal}`,
              "Source text:",
              rawText.slice(0, 12000),
            ].join("\n"),
          },
        ],
      },
    ],
    max_output_tokens: 1200,
  })) as { output_text?: string };

  const output = response.output_text?.trim();
  if (!output) {
    return [];
  }

  try {
    return coercePosts(JSON.parse(output));
  } catch {
    return [];
  }
}
