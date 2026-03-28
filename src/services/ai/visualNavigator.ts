import { env } from "../../config/env";
import type { ActionContext, BrowserAction, JobTraceEvent } from "../../types/job";
import { getOpenAIClient } from "./openaiClient";

const SYSTEM_PROMPT = [
  "You are a browser automation planning agent.",
  "Return exactly one JSON object with keys: type, selector, text, url, waitMs, scrollBy, reason.",
  "Allowed type values: goto, click, type, wait, scroll, extract, done.",
  "Use {{field_name}} token when typing credentials from loginFieldHints.",
  "Never exfiltrate secrets; only use them to complete login.",
  "Choose small, safe steps. Prefer wait after transitions.",
].join(" ");

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
    `Login hints: ${JSON.stringify(context.loginFieldHints ?? [])}`,
    `Recent trace:\n${shortTrace || "none"}`,
    "Return next action as JSON object only.",
  ].join("\n\n");
}

export async function getNextAction(context: ActionContext, trace: JobTraceEvent[]): Promise<BrowserAction> {
  const client = getOpenAIClient();
  const response = (await client.responses.create({
    model: env.openaiModel,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: SYSTEM_PROMPT }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: buildUserPrompt(context, trace) },
          {
            type: "input_image",
            image_url: `data:image/png;base64,${context.screenshotBase64}`,
            detail: "auto",
          },
        ],
      },
    ],
    max_output_tokens: 250,
  })) as { output_text?: string };

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
