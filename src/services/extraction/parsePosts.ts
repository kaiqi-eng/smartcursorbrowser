import { env } from "../../config/env";
import { getOpenAIClient } from "../ai/openaiClient";

interface ParsedPost {
  title: string;
  content: string;
}

function fallbackParsePosts(rawText: string): ParsedPost[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const posts: ParsedPost[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const title = lines[i];
    if (!title || title.length > 140) {
      continue;
    }

    // Prefer using the next non-empty line as content.
    const content = lines[i + 1] ?? "";
    if (!content || content === title) {
      continue;
    }

    posts.push({ title, content });
    if (posts.length >= 20) {
      break;
    }
  }

  return posts;
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
  try {
    const completion = (await client.chat.completions.create({
      model: env.openaiModel,
      messages: [
        {
          role: "system",
          content:
            "Extract post-like entries from website text. Keep wording as close to source as possible. Do not paraphrase unless needed for minimal readability.",
        },
        {
          role: "user",
          content: [
            "Return an object with a single key `posts` as an array of `{title, content}`.",
            "Rules:",
            "- Keep title/content very close to source text (minimal adjustments).",
            "- If title is missing, set title to empty string.",
            "- If there are no clear posts, return `{ \"posts\": [] }`.",
            `Goal context: ${goal}`,
            "Source text:",
            rawText.slice(0, 12000),
          ].join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parsed_posts",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              posts: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    content: { type: "string" },
                  },
                  required: ["title", "content"],
                },
              },
            },
            required: ["posts"],
          },
          strict: true,
        },
      },
      max_tokens: 1200,
    })) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const content = completion.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return fallbackParsePosts(rawText);
    }

    const parsed = JSON.parse(content) as { posts?: unknown };
    const coerced = coercePosts(parsed.posts);
    return coerced.length > 0 ? coerced : fallbackParsePosts(rawText);
  } catch {
    return fallbackParsePosts(rawText);
  }
}
