import { env } from "../../config/env";
import { getOpenAIClient } from "../ai/openaiClient";

interface ParsedPost {
  title: string;
  content: string;
}

const HTML_MODEL_INPUT_MAX_CHARS = 180000;
const TEXT_MODEL_INPUT_MAX_CHARS = 60000;

function makeHeadTailSnippet(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  const separator = "\n<!-- ... middle truncated ... -->\n";
  const budget = Math.max(0, maxChars - separator.length);
  const headSize = Math.floor(budget / 2);
  const tailSize = budget - headSize;
  return `${content.slice(0, headSize)}${separator}${content.slice(-tailSize)}`;
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
  const textForModel = makeHeadTailSnippet(rawText, TEXT_MODEL_INPUT_MAX_CHARS);

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
            textForModel,
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

export async function parsePostsFromHtml(rawHtml: string, goal: string, fallbackRawText = ""): Promise<ParsedPost[]> {
  if (!rawHtml.trim() || !env.openaiApiKey) {
    return fallbackRawText.trim() ? parsePostsFromRawText(fallbackRawText, goal) : [];
  }
  const htmlForModel = makeHeadTailSnippet(rawHtml, HTML_MODEL_INPUT_MAX_CHARS);

  const client = getOpenAIClient();
  try {
    const completion = (await client.chat.completions.create({
      model: env.openaiModel,
      messages: [
        {
          role: "system",
          content:
            "Extract feed/post entries from HTML. Prefer article/card/feed items and keep wording close to source text without unnecessary paraphrase.",
        },
        {
          role: "user",
          content: [
            "Return JSON object: {\"posts\": [{\"title\": string, \"content\": string}]}",
            "Rules:",
            "- Use visible content from the HTML (avoid script/style/meta/json blobs).",
            "- Include as many distinct posts as reliably identifiable.",
            "- If title is missing, set it to empty string.",
            "- If no posts are found, return {\"posts\":[]}.",
            `Goal context: ${goal}`,
            "Source HTML:",
            htmlForModel,
          ].join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "parsed_posts_html",
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
      max_tokens: 1600,
    })) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    const content = completion.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return fallbackRawText.trim() ? parsePostsFromRawText(fallbackRawText, goal) : [];
    }
    const parsed = JSON.parse(content) as { posts?: unknown };
    const coerced = coercePosts(parsed.posts);
    if (coerced.length > 0) {
      return coerced;
    }
    return fallbackRawText.trim() ? parsePostsFromRawText(fallbackRawText, goal) : [];
  } catch {
    return fallbackRawText.trim() ? parsePostsFromRawText(fallbackRawText, goal) : [];
  }
}
