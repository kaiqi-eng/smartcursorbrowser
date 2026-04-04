import { env } from "../config/env";
import { getNextAction } from "../services/ai/visualNavigator";
import { executeBrowserAction } from "../services/browser/actions";
import {
  attemptDeterministicLogin,
  isLikelyLoggedIn,
  navigateToLoginEntry,
} from "../services/browser/loginFlow";
import { performOtterLoginFlow } from "../services/browser/otterFlow";
import { closeBrowserSession, createBrowserSession } from "../services/browser/session";
import { extractResult } from "../services/extraction/extract";
import { shouldStop } from "../services/extraction/stopCriteria";
import { JobStore } from "../services/jobStore";
import { maskError } from "../services/security/redaction";
import type { ActionContext, JobTraceEvent } from "../types/job";

const MAX_ACTION_RETRIES = 3;
const SNAPSHOT_RETRIES = 3;
const MAX_TEMP_RESTRICTED_DONE_RETRIES = 3;

function isTransientContextError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("execution context was destroyed") || message.includes("cannot find context");
}

function shouldCaptureScreenshot(step: number, retryError?: string): boolean {
  if (step === 1) {
    return true;
  }

  if (retryError) {
    return true;
  }

  return step % env.screenshotEveryNSteps === 0;
}

function pushTrace(trace: JobTraceEvent[], event: JobTraceEvent): void {
  trace.push(event);
  if (trace.length > env.maxTraceEvents) {
    trace.shift();
  }
}

function isTemporaryRestrictedDoneAction(action: { type: string; reason?: string }): boolean {
  if (action.type !== "done") {
    return false;
  }

  const reason = (action.reason ?? "").toLowerCase();

  return (
    reason.includes("access is temporarily restricted") ||
    reason.includes("temporarily restricted")
  );
}

async function captureStepContext(
  page: Awaited<ReturnType<typeof createBrowserSession>>["page"],
  includeScreenshot = false,
): Promise<{
  screenshotBase64?: string;
  textSnapshot: string;
  currentUrl: string;
  pageTitle: string;
}> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= SNAPSHOT_RETRIES; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });

      const textSnapshot = await page.evaluate(() => document.body?.innerText?.slice(0, 2500) ?? "");

      const screenshotBase64 = includeScreenshot
        ? (await page.screenshot({ type: "jpeg", quality: 45, fullPage: false })).toString("base64")
        : undefined;

      return {
        screenshotBase64,
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
    let carryOverError: string | undefined;
    let goalSatisfiedEarly = false;
    let tempRestrictedDoneCount = 0;

    jobStore.updateStatus(jobId, "running", "Browser session starting");

    let session: Awaited<ReturnType<typeof createBrowserSession>> | null = null;

    try {
      session = await createBrowserSession(job.request.userAgent);
      await session.page.goto(job.request.url, { waitUntil: "domcontentloaded" });

      if (job.request.sourceType === "otter") {
        if ((job.request.loginFields?.length ?? 0) === 0) {
          throw new Error("Otter jobs require login credentials");
        }

        jobStore.updateProgress(jobId, 0, "Logging in to Otter");
        await performOtterLoginFlow(session.page, job.request.url, job.request.loginFields ?? []);

        const result = await extractResult(
          session.page,
          trace,
          job.request.extractionSchema,
          job.request.goal,
          "otter",
        );

        jobStore.setResult(jobId, result);

        if (!result.goalAssessment?.meetsGoal) {
          jobStore.setError(
            jobId,
            `Goal validation failed (${result.goalAssessment?.confidence ?? "low"}): ${result.goalAssessment?.reason ?? "Otter extraction failed"}`,
          );
          jobStore.updateStatus(jobId, "failed", "Goal not satisfied");
          return;
        }

        jobStore.updateStatus(jobId, "succeeded", "Otter transcript extraction completed");
        return;
      }

      if ((job.request.loginFields?.length ?? 0) > 0) {
        const loggedIn = await isLikelyLoggedIn(session.page);
        if (loggedIn) {
          confirmedLoggedIn = true;
        }
        if (!loggedIn) {
          jobStore.updateProgress(jobId, 0, "Attempting login");
          await navigateToLoginEntry(session.page);
          await attemptDeterministicLogin(session.page, job.request.loginFields ?? []);
        }
      }

      for (let step = 1; step <= maxSteps; step += 1) {
        const latestJob = jobStore.get(jobId);
        if (!latestJob || latestJob.cancelRequested) {
          jobStore.updateStatus(jobId, "cancelled", "Job cancelled");
          return;
        }

        let shouldEnd = false;
        let stepExecutionFailed = false;
        let retryError = carryOverError;

        for (let attempt = 1; attempt <= MAX_ACTION_RETRIES; attempt += 1) {
          const includeScreenshot = shouldCaptureScreenshot(step, retryError);
          const stepContext = await captureStepContext(session.page, includeScreenshot);

          const context: ActionContext = {
            step,
            goal: job.request.goal,
            currentUrl: stepContext.currentUrl,
            pageTitle: stepContext.pageTitle,
            screenshotBase64: stepContext.screenshotBase64,
            textSnapshot: stepContext.textSnapshot,
            lastError: retryError,
            loginFieldHints: confirmedLoggedIn
              ? []
              : (job.request.loginFields ?? []).map((field) => ({
                  name: field.name,
                  selector: field.selector,
                  secret: field.secret ?? false,
                })),
          };

          jobStore.updateLiveView(jobId, {
            currentUrl: context.currentUrl,
            pageTitle: context.pageTitle,
            screenshotBase64: env.enableLiveScreenshots ? context.screenshotBase64 : undefined,
          });

          let action = await getNextAction(context, trace);
          const hasLoginFields = (job.request.loginFields?.length ?? 0) > 0;

          if (hasLoginFields && (action.type === "done" || action.type === "extract")) {
            const loggedIn = await isLikelyLoggedIn(session.page);
            if (!loggedIn) {
              await navigateToLoginEntry(session.page);
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
          if (validationRetryStreak > 0 && (action.type === "done" || action.type === "extract")) {
            action = {
              type: "scroll",
              scrollBy: 900,
              reason: `Goal validation previously failed; forcing additional exploration before retrying completion (streak: ${validationRetryStreak}).`,
            };
          }

          // NEW: Handle "Access is temporarily restricted" done action up to 3 times only
          if (isTemporaryRestrictedDoneAction(action)) {
            tempRestrictedDoneCount += 1;

            pushTrace(trace, {
              timestamp: new Date().toISOString(),
              step,
              action,
              note: `Temporary restricted done detected (${tempRestrictedDoneCount}/${MAX_TEMP_RESTRICTED_DONE_RETRIES})`,
            });

            if (tempRestrictedDoneCount < MAX_TEMP_RESTRICTED_DONE_RETRIES) {
              carryOverError = `Access temporarily restricted detected (${tempRestrictedDoneCount}/${MAX_TEMP_RESTRICTED_DONE_RETRIES}). Retrying with alternate approach.`;

              jobStore.updateProgress(
                jobId,
                step,
                `Access temporarily restricted (${tempRestrictedDoneCount}/${MAX_TEMP_RESTRICTED_DONE_RETRIES}). Retrying...`,
              );

              // wait a little and continue to next step instead of ending
              await session.page.waitForTimeout(2000);
              stepExecutionFailed = true;
              break;
            }

            jobStore.setError(
              jobId,
              "Access is temporarily restricted, cannot proceed further after 3 retries",
            );
            jobStore.updateStatus(jobId, "failed", "Access temporarily restricted after 3 retries");
            return;
          }

          const note = action.reason ?? "No reason provided";

          pushTrace(trace, {
            timestamp: new Date().toISOString(),
            step,
            action,
            note: `[attempt ${attempt}] ${note}`,
          });

          jobStore.updateProgress(jobId, step, `${action.type}: ${note}`);

          if (shouldStop(action, step, maxSteps, startedAtMs, timeoutMs)) {
            if (action.type === "done" || action.type === "extract") {
              const interimResult = await extractResult(
                session.page,
                trace,
                job.request.extractionSchema,
                job.request.goal,
                job.request.sourceType ?? "generic",
              );
              jobStore.setValidationPayload(jobId, interimResult.validationPayload);

              if (interimResult.goalAssessment?.meetsGoal) {
                goalSatisfiedEarly = true;
                jobStore.setResult(jobId, interimResult);
                shouldEnd = true;
                break;
              }

              const hasLoginFields = (job.request.loginFields?.length ?? 0) > 0;
              if (hasLoginFields && !confirmedLoggedIn) {
                const loggedIn = await isLikelyLoggedIn(session.page);
                if (loggedIn) {
                  confirmedLoggedIn = true;
                } else if (await isLikelyLoginPage(session.page)) {
                  await navigateToLoginEntry(session.page);
                  await attemptDeterministicLogin(session.page, job.request.loginFields ?? []);
                }
              }

              carryOverError = `Goal not met yet at step ${step}; continue exploring target content`;
              validationRetryStreak += 1;
              jobStore.updateProgress(
                jobId,
                step,
                "AI attempted completion but goal validation failed; continuing to gather posts",
              );
              break;
            }

            shouldEnd = true;
            break;
          }

          try {
            await executeBrowserAction(session.page, action, job.request.loginFields ?? []);
            retryError = undefined;
            carryOverError = undefined;
            validationRetryStreak = 0;
            break;
          } catch (error) {
            retryError = maskError(error);

            jobStore.updateProgress(
              jobId,
              step,
              `Retrying action after error (${attempt}/${MAX_ACTION_RETRIES}): ${retryError}`,
            );

            if (attempt === MAX_ACTION_RETRIES) {
              carryOverError = retryError;
              stepExecutionFailed = true;

              pushTrace(trace, {
                timestamp: new Date().toISOString(),
                step,
                action: {
                  type: "wait",
                  waitMs: 800,
                  reason: "Action failed this step; carrying error into next replanning step.",
                },
                note: `Step execution failed after ${MAX_ACTION_RETRIES} attempts: ${retryError}`,
              });

              jobStore.updateProgress(
                jobId,
                step,
                `Action failed after ${MAX_ACTION_RETRIES} attempts; continuing with next AI step`,
              );

              break;
            }
          }
        }

        if (shouldEnd) {
          break;
        }

        if (stepExecutionFailed) {
          continue;
        }
      }

      if (goalSatisfiedEarly) {
        jobStore.updateStatus(jobId, "succeeded", "Scrape completed");
      } else {
        const result = await extractResult(
          session.page,
          trace,
          job.request.extractionSchema,
          job.request.goal,
          job.request.sourceType ?? "generic",
        );

        jobStore.setResult(jobId, result);

        if (result.goalAssessment && !result.goalAssessment.meetsGoal) {
          jobStore.setError(
            jobId,
            `Goal validation failed after full run (${result.goalAssessment.confidence}): ${result.goalAssessment.reason}`,
          );
          jobStore.updateStatus(jobId, "failed", "Goal not satisfied after max steps");
        } else {
          jobStore.updateStatus(jobId, "succeeded", "Scrape completed");
        }
      }
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