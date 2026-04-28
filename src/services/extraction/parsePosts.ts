import { env } from "../../config/env";
import { getOpenAIClient } from "../ai/openaiClient";
import { withTimeout } from "../../utils/timeout";

interface ParsedPost {
  timestamp: string;
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
  const standaloneTimestampPattern = /^(?:\d+\s*[smhdw]\s*){1,3}(?:ago)?$/i;
  const timestampWithTrailingPattern = /^((?:\d+\s*[smhdw]\s*){1,3}(?:ago)?)(?:\s*[|:\-]\s*|\s+)(.+)$/i;
  let currentPost: ParsedPost | null = null;

  const pushCurrentPost = () => {
    if (!currentPost) {
      return;
    }
    const cleanedContent = currentPost.content.trim();
    if (!cleanedContent) {
      currentPost = null;
      return;
    }
    posts.push({
      timestamp: currentPost.timestamp.trim(),
      content: cleanedContent,
    });
    currentPost = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trailingMatch = line.match(timestampWithTrailingPattern);
    const isStandaloneTimestamp = standaloneTimestampPattern.test(line);

    if (trailingMatch || isStandaloneTimestamp) {
      pushCurrentPost();

      const timestamp = (trailingMatch ? trailingMatch[1] : line).replace(/\s+/g, "").toLowerCase();
      const initialContent = trailingMatch ? trailingMatch[2].trim() : "";
      currentPost = {
        timestamp,
        content: initialContent,
      };
      if (posts.length >= 20) {
        break;
      }
      continue;
    }

    if (!currentPost) {
      continue;
    }

    currentPost.content = currentPost.content ? `${currentPost.content}\n${line}` : line;
  }

  pushCurrentPost();
  return posts.slice(0, 20);
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
      const timestamp =
        typeof (item as { timestamp?: unknown }).timestamp === "string"
          ? (item as { timestamp: string }).timestamp.trim().toLowerCase()
          : "";
      const content =
        typeof (item as { content?: unknown }).content === "string" ? (item as { content: string }).content.trim() : "";
      if (!timestamp || !content) {
        return null;
      }
      return { timestamp, content };
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
    const completion = (await withTimeout(
      client.chat.completions.create({
        model: env.openaiModel,
        messages: [
          {
            role: "system",
            content:
              "Extract post-like entries from website text. Keep wording as close to source as possible and avoid paraphrasing.",
          },
          {
            role: "user",
            content: [
              "Return an object with a single key `posts` as an array of `{timestamp, content}`.",
              "Rules:",
              "- Keep content as raw text chunks with only minimal cleanup.",
              "- Timestamp must be a relative label copied from source such as `1d`, `1h`, `30m`.",
              "- Do not extract or infer titles.",
              "- If a post does not have a clear relative timestamp label, omit that post.",
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
                      timestamp: { type: "string" },
                      content: { type: "string" },
                    },
                    required: ["timestamp", "content"],
                  },
                },
              },
              required: ["posts"],
            },
            strict: true,
          },
        },
        max_tokens: 1200,
      }),
      env.aiTimeoutMs,
      "parse posts from raw text",
    )) as {
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
    const completion = (await withTimeout(
      client.chat.completions.create({
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
              "Return JSON object: {\"posts\": [{\"timestamp\": string, \"content\": string}]}",
              "Rules:",
              "- Use visible content from the HTML (avoid script/style/meta/json blobs).",
              "- Include as many distinct posts as reliably identifiable.",
              "- Include a relative timestamp label copied from source (examples: `1d`, `1h`, `30m`).",
              "- Do not extract or infer titles.",
              "- If a post has no clear relative timestamp label, omit it.",
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
                      timestamp: { type: "string" },
                      content: { type: "string" },
                    },
                    required: ["timestamp", "content"],
                  },
                },
              },
              required: ["posts"],
            },
            strict: true,
          },
        },
        max_tokens: 1600,
      }),
      env.aiTimeoutMs,
      "parse posts from html",
    )) as {
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
