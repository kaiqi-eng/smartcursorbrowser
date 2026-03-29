import type { Page } from "playwright";
import type { JobTraceEvent, ScrapeResult } from "../../types/job";
import { parsePostsFromRawText } from "./parsePosts";

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
  const rawText = await page.evaluate(() => document.body?.innerText?.slice(0, 8000) ?? "");

  let extractedData: Record<string, unknown> | undefined;
  if (extractionSchema) {
    const fromDom = await page.evaluate((schema) => {
      const result: Record<string, string> = {};
      Object.entries(schema).forEach(([key, selector]) => {
        const element = document.querySelector(selector);
        result[key] = element?.textContent?.trim() ?? "";
      });
      return result;
    }, extractionSchema);
    extractedData = asRecordOrUndefined(fromDom);
  }

  const parsedPosts = await parsePostsFromRawText(rawText, goal);

  return {
    finalUrl,
    pageTitle,
    rawText,
    extractedData,
    parsedPosts,
    trace,
  };
}
