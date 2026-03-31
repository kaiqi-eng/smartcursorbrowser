import type { Page } from "playwright";
import type { JobTraceEvent, ScrapeResult } from "../../types/job";
import { parsePostsFromRawText } from "./parsePosts";
import { validateGoalAgainstExtraction } from "./validateGoal";

const EXTRACTION_RETRIES = 3;

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

export async function extractResult(
  page: Page,
  trace: JobTraceEvent[],
  extractionSchema?: Record<string, string>,
  goal = "",
): Promise<ScrapeResult> {
  const pageTitle = await page.title();
  const finalUrl = page.url();
  const rawText = await withContextRetry(page, () => page.evaluate(() => document.body?.innerText?.slice(0, 8000) ?? ""));

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
    goalAssessment,
    trace,
  };
}
