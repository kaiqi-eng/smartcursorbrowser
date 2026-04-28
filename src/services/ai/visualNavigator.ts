import { env } from "../../config/env";
import type { ActionContext, BrowserAction, JobTraceEvent } from "../../types/job";
import { getOpenAIClient } from "./openaiClient";
import { withTimeout } from "../../utils/timeout";

const SYSTEM_PROMPT = `You are a browser automation agent. Your only output must be a single raw JSON object — no markdown, no code fences, no explanation.

REQUIRED JSON shape:
{
  "type": "<one of: goto | click | type | wait | scroll | extract | done>",
  "selector": "<CSS selector string, only for click/type when needed>",
  "x": <x coordinate integer, only for click>,
  "y": <y coordinate integer, only for click>,
  "text": "<text to type or credential token like {{username}}, only for type>",
  "url": "<full URL, only for goto>",
  "waitMs": <milliseconds integer, only for wait>,
  "scrollBy": <pixels integer (positive=down), only for scroll>,
  "reason": "<one sentence explaining why this action>"
}

RULES:
- Output ONLY the JSON object. No prose before or after.
- Every response must include "type" and "reason". All other keys are optional and only needed for the chosen type.
- Prefer extraction from the current page before any click.
- Avoid clicks unless navigation or expansion is clearly required.
- Prefer scrolling over clicking when searching for feed content.
- Never click ads, popups, cookie banners, or unrelated controls.
- If content already appears present in the text snapshot, use extract or done.
- Limit navigation changes unless the goal explicitly requires a page transition.
- For click actions, prioritize image-driven coordinate clicks only when a screenshot is available; otherwise prefer selector-based clicks.
- Use selector-based click only when coordinates are uncertain or clearly unsafe.
- For type actions, prefer stable selectors: id (#id), data attributes ([data-testid="x"]), or aria ([aria-label="x"]) over fragile nth-child or class chains.
- If the last action failed, pick a different selector strategy entirely — never repeat the same failing selector.
- Use {{field_name}} tokens to reference login credentials, never hard-code secrets.
- If the page has fully loaded and the goal is achieved, return {"type":"done","reason":"Goal complete."}.
- If unsure what to do next, return {"type":"scroll","scrollBy":500,"reason":"Scanning page for relevant content with minimal interaction."}.`;

const FALLBACK_ACTION: BrowserAction = {
  type: "wait",
  waitMs: 1200,
  reason: "Fallback wait action due to parse failure.",
};

function toAction(jsonText: string): BrowserAction {
  const parsed = JSON.parse(jsonText) as BrowserAction;
  return {
    type: parsed.type,
    selector: parsed.selector,
    x: parsed.x,
    y: parsed.y,
    text: parsed.text,
    url: parsed.url,
    waitMs: parsed.waitMs,
    scrollBy: parsed.scrollBy,
    reason: parsed.reason,
  };
}

function buildUserPrompt(context: ActionContext, trace: JobTraceEvent[]): string {
  const shortTrace = trace
    .slice(-5)
    .map((event) => `${event.step}. ${event.action.type} - ${event.note}`)
    .join("\n");

  return [
    `Goal: ${context.goal}`,
    `Current URL: ${context.currentUrl}`,
    `Page title: ${context.pageTitle}`,
    `Text snapshot: ${context.textSnapshot.slice(0, 2000)}`,
    `Step: ${context.step}`,
    `Last action error: ${context.lastError ?? "none"}`,
    `Login hints: ${JSON.stringify(context.loginFieldHints ?? [])}`,
    `Recent trace:\n${shortTrace || "none"}`,
    `Screenshot available: ${context.screenshotBase64 ? "yes" : "no"}`,
    "Return next action as JSON object only.",
  ].join("\n\n");
}

export async function getNextAction(context: ActionContext, trace: JobTraceEvent[]): Promise<BrowserAction> {
  const client = getOpenAIClient();

  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" }
  > = [{ type: "input_text", text: buildUserPrompt(context, trace) }];

  if (context.screenshotBase64) {
    userContent.push({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${context.screenshotBase64}`,
      detail: "low",
    });
  }

  const response = (await withTimeout(
    client.responses.create({
      model: env.openaiModel,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      max_output_tokens: 250,
    }),
    env.aiTimeoutMs,
    "visual navigator action planning",
  )) as { output_text?: string };

  const outputText = response.output_text?.trim();
  if (!outputText) {
    return FALLBACK_ACTION;
  }

  try {
    return toAction(outputText);
  } catch {
    return FALLBACK_ACTION;
  }
}