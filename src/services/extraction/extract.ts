import { env } from "../../config/env";
import type { Page } from "playwright";
import type { JobTraceEvent, ScrapeResult } from "../../types/job";
import { parsePostsFromRawText } from "./parsePosts";
import { extractOtterSummaryAndTranscript } from "./otterExtract";
import { buildValidationPayload, validateGoalAgainstExtraction } from "./validateGoal";

const EXTRACTION_RETRIES = 3;
const FINAL_SCROLL_ITERATIONS = 8;
const FINAL_SCROLL_PAUSE_MS = 250;
const FINAL_SCROLL_STEP_PX = 700;

function isTransientContextError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("execution context was destroyed") || message.includes("cannot find context");
}

async function withContextRetry<T>(page: Page, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= EXTRACTION_RETRIES; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      return await task();
    } catch (error) {
      lastError = error;
      if (!isTransientContextError(error) || attempt === EXTRACTION_RETRIES) {
        throw error;
      }
      await page.waitForTimeout(350);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Extraction failed");
}

function asRecordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function pushTrace(trace: JobTraceEvent[], event: JobTraceEvent): void {
  trace.push(event);
  if (trace.length > env.maxTraceEvents) {
    trace.shift();
  }
}

function truncateRawText(rawText: string): string {
  if (rawText.length <= env.maxRawTextChars) {
    return rawText;
  }

  return `${rawText.slice(0, env.maxRawTextChars)}\n...truncated...`;
}

async function collectFinalPageSnapshot(page: Page): Promise<{ rawText: string }> {
  let stagnantTicks = 0;

  for (let i = 0; i < FINAL_SCROLL_ITERATIONS; i += 1) {
    const before = await withContextRetry(page, () =>
      page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const pageHeight = Math.max(root?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
        const pageY = Math.max(window.scrollY, root?.scrollTop ?? 0, body?.scrollTop ?? 0);
        const scrollables = Array.from(document.querySelectorAll<HTMLElement>("*"))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;
            return (
              (overflowY === "auto" || overflowY === "scroll") &&
              el.scrollHeight > el.clientHeight + 20 &&
              el.clientHeight > 80
            );
          })
          .sort((a, b) => b.clientHeight - a.clientHeight);

        const primaryScrollable = scrollables[0];

        return {
          pageHeight,
          pageY,
          containerTop: primaryScrollable?.scrollTop ?? 0,
          containerHeight: primaryScrollable?.scrollHeight ?? 0,
        };
      }),
    );

    await page.mouse.wheel(0, FINAL_SCROLL_STEP_PX);

    await withContextRetry(page, () =>
      page.evaluate((scrollBy) => {
        window.scrollBy(0, scrollBy);

        const scrollables = Array.from(document.querySelectorAll<HTMLElement>("*"))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;
            return (
              (overflowY === "auto" || overflowY === "scroll") &&
              el.scrollHeight > el.clientHeight + 20 &&
              el.clientHeight > 80
            );
          })
          .sort((a, b) => b.clientHeight - a.clientHeight);

        const primaryScrollable = scrollables[0];
        if (primaryScrollable) {
          primaryScrollable.scrollBy({ top: scrollBy, behavior: "auto" });
        }
      }, FINAL_SCROLL_STEP_PX),
    );

    await page.waitForTimeout(FINAL_SCROLL_PAUSE_MS);

    const after = await withContextRetry(page, () =>
      page.evaluate(() => {
        const root = document.documentElement;
        const body = document.body;
        const pageHeight = Math.max(root?.scrollHeight ?? 0, body?.scrollHeight ?? 0);
        const pageY = Math.max(window.scrollY, root?.scrollTop ?? 0, body?.scrollTop ?? 0);
        const scrollables = Array.from(document.querySelectorAll<HTMLElement>("*"))
          .filter((el) => {
            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;
            return (
              (overflowY === "auto" || overflowY === "scroll") &&
              el.scrollHeight > el.clientHeight + 20 &&
              el.clientHeight > 80
            );
          })
          .sort((a, b) => b.clientHeight - a.clientHeight);

        const primaryScrollable = scrollables[0];

        return {
          pageHeight,
          pageY,
          containerTop: primaryScrollable?.scrollTop ?? 0,
          containerHeight: primaryScrollable?.scrollHeight ?? 0,
        };
      }),
    );

    const progressed =
      after.pageY > before.pageY + 2 ||
      after.pageHeight > before.pageHeight + 8 ||
      after.containerTop > before.containerTop + 2 ||
      after.containerHeight > before.containerHeight + 8;

    if (!progressed) {
      stagnantTicks += 1;
    } else {
      stagnantTicks = 0;
    }

    if (stagnantTicks >= 3) {
      break;
    }
  }

  const rawText = await withContextRetry(page, () =>
    page.evaluate(() => {
      const chunks: string[] = [];
      const seen: Record<string, true> = {};
      const normalizeMultiline = (value: string): string =>
        value
          .split(/\r?\n/)
          .map((line) => line.replace(/[ \t]+/g, " ").trim())
          .filter(Boolean)
          .join("\n");

      const baseText = normalizeMultiline(document.body?.innerText ?? "");
      if (baseText) {
        chunks.push(baseText);
        seen[baseText] = true;
      }

      const titleText = (document.title ?? "").replace(/\s+/g, " ").trim();
      if (titleText && !seen[titleText]) {
        chunks.push(titleText);
        seen[titleText] = true;
      }

      const metaDesc = (document.querySelector("meta[name='description']")?.getAttribute("content") ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (metaDesc && !seen[metaDesc]) {
        chunks.push(metaDesc);
        seen[metaDesc] = true;
      }

      const semanticNodes = document.querySelectorAll<HTMLElement>(
        "[aria-label], [alt], [title], input, textarea, button, a, [role='button']",
      );

      for (let i = 0; i < semanticNodes.length; i += 1) {
        const node = semanticNodes[i];
        const candidates = [
          node.getAttribute("aria-label") ?? "",
          node.getAttribute("alt") ?? "",
          node.getAttribute("title") ?? "",
        ];

        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
          candidates.push(node.placeholder ?? "", node.value ?? "");
        }

        for (let j = 0; j < candidates.length; j += 1) {
          const normalized = candidates[j].replace(/\s+/g, " ").trim();
          if (!normalized || seen[normalized]) {
            continue;
          }
          chunks.push(normalized);
          seen[normalized] = true;
        }
      }

      return chunks.join("\n");
    }),
  );

  return { rawText: truncateRawText(rawText) };
}

export async function extractResult(
  page: Page,
  trace: JobTraceEvent[],
  extractionSchema?: Record<string, string>,
  goal = "",
  sourceType: "generic" | "otter" = "generic",
): Promise<ScrapeResult> {
  const pageTitle = await page.title();
  const finalUrl = page.url();

  if (sourceType === "otter") {
    const otterResult = await extractOtterSummaryAndTranscript(page);
    const meetsGoal = Boolean(otterResult.summary || otterResult.transcript);

    return {
      finalUrl,
      sourceUrl: finalUrl,
      pageTitle,
      summary: otterResult.summary,
      transcript: otterResult.transcript,
      goalAssessment: {
        meetsGoal,
        confidence: meetsGoal ? "high" : "low",
        reason: meetsGoal
          ? "Extracted summary or transcript from Otter page."
          : "Could not locate summary or transcript.",
        missingRequirements: meetsGoal ? [] : ["summary or transcript"],
      },
      trace,
    };
  }

  const { rawText } = await collectFinalPageSnapshot(page);

  pushTrace(trace, {
    timestamp: new Date().toISOString(),
    step: trace.length > 0 ? trace[trace.length - 1].step : 0,
    action: {
      type: "scroll",
      scrollBy: 0,
      reason: "Performed final extraction scroll pass and captured comprehensive text snapshot.",
    },
    note: "Final extraction uses reduced auto-scroll and text-first capture.",
  });

  let extractedData: Record<string, unknown> | undefined;

  if (extractionSchema) {
    const fromDom = await withContextRetry(page, () =>
      page.evaluate((schema) => {
        const result: Record<string, string> = {};
        Object.entries(schema).forEach(([key, selector]) => {
          const element = document.querySelector(selector);
          result[key] = element?.textContent?.trim() ?? "";
        });
        return result;
      }, extractionSchema),
    );

    extractedData = asRecordOrUndefined(fromDom);
  }

  const parsedPosts = await parsePostsFromRawText(rawText, goal);
  const validationPayload = buildValidationPayload({
    goal,
    finalUrl,
    pageTitle,
    rawText,
    parsedPosts,
    extractedData,
  });
  const goalAssessment = await validateGoalAgainstExtraction({
    goal,
    finalUrl,
    pageTitle,
    rawText,
    parsedPosts,
    extractedData,
  });

  return {
    finalUrl,
    pageTitle,
    rawText,
    extractedData,
    parsedPosts,
    validationPayload,
    goalAssessment,
    trace,
  };
}