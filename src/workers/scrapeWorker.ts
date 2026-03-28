import { env } from "../config/env";
import { getNextAction } from "../services/ai/visualNavigator";
import { executeBrowserAction } from "../services/browser/actions";
import { closeBrowserSession, createBrowserSession } from "../services/browser/session";
import { extractResult } from "../services/extraction/extract";
import { shouldStop } from "../services/extraction/stopCriteria";
import { JobStore } from "../services/jobStore";
import { maskError } from "../services/security/redaction";
import type { ActionContext, JobTraceEvent } from "../types/job";

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

    const session = await createBrowserSession(job.request.userAgent);
    try {
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

        const screenshot = await session.page.screenshot({ type: "png", fullPage: false });
        const textSnapshot = await session.page.evaluate(() => document.body?.innerText?.slice(0, 3500) ?? "");
        const context: ActionContext = {
          step,
          goal: job.request.goal,
          currentUrl: session.page.url(),
          pageTitle: await session.page.title(),
          screenshotBase64: screenshot.toString("base64"),
          textSnapshot,
          loginFieldHints: (job.request.loginFields ?? []).map((field) => ({
            name: field.name,
            selector: field.selector,
            secret: field.secret ?? false,
          })),
        };

        const action = await getNextAction(context, trace);
        const note = action.reason ?? "No reason provided";
        trace.push({
          timestamp: new Date().toISOString(),
          step,
          action,
          note,
        });
        jobStore.updateProgress(jobId, step, `${action.type}: ${note}`);

        if (shouldStop(action, step, maxSteps, startedAtMs, timeoutMs)) {
          break;
        }
        await executeBrowserAction(session.page, action, job.request.loginFields ?? []);
      }

      const result = await extractResult(session.page, trace, job.request.extractionSchema);
      jobStore.setResult(jobId, result);
      jobStore.updateStatus(jobId, "succeeded", "Scrape completed");
    } catch (error) {
      jobStore.setError(jobId, maskError(error));
      jobStore.updateStatus(jobId, "failed", "Execution failed");
    } finally {
      await closeBrowserSession(session);
    }
  };
}
