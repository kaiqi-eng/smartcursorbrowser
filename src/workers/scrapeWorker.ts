import { env } from "../config/env";
import { getNextAction } from "../services/ai/visualNavigator";
import { executeBrowserAction } from "../services/browser/actions";
import { attemptDeterministicLogin, isLikelyLoginPage } from "../services/browser/loginFlow";
import { closeBrowserSession, createBrowserSession } from "../services/browser/session";
import { extractResult } from "../services/extraction/extract";
import { shouldStop } from "../services/extraction/stopCriteria";
import { JobStore } from "../services/jobStore";
import { maskError } from "../services/security/redaction";
import type { ActionContext, JobTraceEvent } from "../types/job";

const MAX_ACTION_RETRIES = 3;
const SNAPSHOT_RETRIES = 3;

function isTransientContextError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("execution context was destroyed") || message.includes("cannot find context");
}

async function captureStepContext(page: Awaited<ReturnType<typeof createBrowserSession>>["page"]): Promise<{
  screenshotBase64: string;
  textSnapshot: string;
  currentUrl: string;
  pageTitle: string;
}> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SNAPSHOT_RETRIES; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      const screenshot = await page.screenshot({ type: "png", fullPage: false });
      const textSnapshot = await page.evaluate(() => document.body?.innerText?.slice(0, 3500) ?? "");
      return {
        screenshotBase64: screenshot.toString("base64"),
        textSnapshot,
        currentUrl: page.url(),
        pageTitle: await page.title(),
      };
    } catch (error) {
      lastError = error;
      if (!isTransientContextError(error) || attempt === SNAPSHOT_RETRIES) {
        throw error;
      }
      await page.waitForTimeout(350);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to capture page context");
}

export function createScrapeWorker(jobStore: JobStore) {
  return async function runJob(jobId: string): Promise<void> {
    const job = jobStore.get(jobId);
    if (!job) {
      return;
    }

    const maxSteps = job.request.maxSteps ?? env.maxJobSteps;
    const timeoutMs = job.request.timeoutMs ?? env.defaultJobTimeoutMs;
    const startedAtMs = Date.now();
    const trace: JobTraceEvent[] = [];
    jobStore.updateStatus(jobId, "running", "Browser session starting");

    let session: Awaited<ReturnType<typeof createBrowserSession>> | null = null;
    try {
      session = await createBrowserSession(job.request.userAgent);
      await session.page.goto(job.request.url, { waitUntil: "domcontentloaded" });
      for (let step = 1; step <= maxSteps; step += 1) {
        const currentJob = jobStore.get(jobId);
        if (!currentJob) {
          throw new Error("Job disappeared from store");
        }
        if (currentJob.cancelRequested) {
          jobStore.updateStatus(jobId, "cancelled", "Cancelled by request");
          return;
        }

        let shouldEnd = false;
        let retryError: string | undefined;
        for (let attempt = 1; attempt <= MAX_ACTION_RETRIES; attempt += 1) {
          const stepContext = await captureStepContext(session.page);
          const context: ActionContext = {
            step,
            goal: job.request.goal,
            currentUrl: stepContext.currentUrl,
            pageTitle: stepContext.pageTitle,
            screenshotBase64: stepContext.screenshotBase64,
            textSnapshot: stepContext.textSnapshot,
            lastError: retryError,
            loginFieldHints: (job.request.loginFields ?? []).map((field) => ({
              name: field.name,
              selector: field.selector,
              secret: field.secret ?? false,
            })),
          };
          jobStore.updateLiveView(jobId, {
            currentUrl: context.currentUrl,
            pageTitle: context.pageTitle,
            screenshotBase64: context.screenshotBase64,
          });

          let action = await getNextAction(context, trace);
          const hasLoginFields = (job.request.loginFields?.length ?? 0) > 0;
          if (hasLoginFields && (action.type === "done" || action.type === "extract")) {
            const stillOnLoginPage = await isLikelyLoginPage(session.page);
            if (stillOnLoginPage) {
              const loginAttempted = await attemptDeterministicLogin(session.page, job.request.loginFields ?? []);
              action = loginAttempted
                ? {
                    type: "wait",
                    waitMs: 1200,
                    reason: "Detected login page; performed deterministic credential submit before continuing.",
                  }
                : {
                    type: "scroll",
                    scrollBy: 500,
                    reason: "Detected login page; bypassing early stop to continue login discovery.",
                  };
            }
          }

          const note = action.reason ?? "No reason provided";
          trace.push({
            timestamp: new Date().toISOString(),
            step,
            action,
            note: `[attempt ${attempt}] ${note}`,
          });
          jobStore.updateProgress(jobId, step, `${action.type}: ${note}`);

          if (shouldStop(action, step, maxSteps, startedAtMs, timeoutMs)) {
            shouldEnd = true;
            break;
          }

          try {
            await executeBrowserAction(session.page, action, job.request.loginFields ?? []);
            retryError = undefined;
            break;
          } catch (error) {
            retryError = maskError(error);
            jobStore.updateProgress(
              jobId,
              step,
              `Retrying action after error (${attempt}/${MAX_ACTION_RETRIES}): ${retryError}`,
            );
            if (attempt === MAX_ACTION_RETRIES) {
              throw new Error(`Action failed after ${MAX_ACTION_RETRIES} attempts: ${retryError}`);
            }
          }
        }

        if (shouldEnd) {
          break;
        }
      }

      const result = await extractResult(session.page, trace, job.request.extractionSchema, job.request.goal);
      jobStore.setResult(jobId, result);
      jobStore.updateStatus(jobId, "succeeded", "Scrape completed");
    } catch (error) {
      jobStore.setError(jobId, maskError(error));
      jobStore.updateStatus(jobId, "failed", "Execution failed");
    } finally {
      if (session) {
        await closeBrowserSession(session);
      }
    }
  };
}
