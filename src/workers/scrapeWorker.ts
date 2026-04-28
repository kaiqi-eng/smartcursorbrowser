import { env } from "../config/env";
import { getNextAction } from "../services/ai/visualNavigator";
import { executeBrowserAction } from "../services/browser/actions";
import {
  attemptDeterministicLogin,
  isLikelyLoginPage,
  isLikelyLoggedIn,
  navigateToLoginEntry,
} from "../services/browser/loginFlow";
import { performOtterLoginFlow } from "../services/browser/otterFlow";
import { closeBrowserSession, createBrowserSession } from "../services/browser/session";
import { extractResult } from "../services/extraction/extract";
import { shouldStop } from "../services/extraction/stopCriteria";
import { runOxylabsFallback } from "../services/fallback/oxylabsFallback";
import { JobStore } from "../services/jobStore";
import { maskError } from "../services/security/redaction";
import type { ActionContext, JobTraceEvent } from "../types/job";
import { withTimeout } from "../utils/timeout";

const MAX_ACTION_RETRIES = 3;
const SNAPSHOT_RETRIES = 3;
const MAX_TEMP_RESTRICTED_DONE_RETRIES = 3;
const SCREENSHOT_TIMEOUT_MS = 8000;

function isTransientContextError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("execution context was destroyed") || message.includes("cannot find context");
}

function isScreenshotTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("page.screenshot") && message.includes("timeout");
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

      let screenshotBase64: string | undefined;
      if (includeScreenshot) {
        try {
          screenshotBase64 = (
            await page.screenshot({
              type: "jpeg",
              quality: 45,
              fullPage: false,
              timeout: SCREENSHOT_TIMEOUT_MS,
              animations: "disabled",
              caret: "hide",
            })
          ).toString("base64");
        } catch (error) {
          // Keep browser loop alive when screenshot capture is flaky.
          if (!isScreenshotTimeoutError(error) && !isTransientContextError(error)) {
            throw error;
          }
        }
      }

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

/**
 * Attempt the Oxylabs fallback extraction and store results on the job.
 * Returns true if the fallback produced usable data.
 */
async function attemptFallback(
  jobId: string,
  url: string,
  jobStore: JobStore,
  session?: Awaited<ReturnType<typeof createBrowserSession>> | null
): Promise<boolean> {
  // Always close the session if provided
  if (session) {
    await closeBrowserSession(session);
    session = null;
  }

  jobStore.updateProgress(jobId, 0, "Browser flow did not meet goal — attempting Oxylabs fallback");

  try {
    let fallbackResults = await runOxylabsFallback(url);

    // Filter out unwanted articles as before
    const errorKeywords = [
      "verify you are a human",
      "access denied",
      "access to this page has been denied",
      "please enable cookies",
      "subscribe",
      "sign in",
      "paywall",
      "robot check",
      "are you a robot",
      "powered by perimeterx",
      "your subscription",
      "customer center",
      "please login",
      "please sign in",
      "not available in your country"
    ];

    fallbackResults = fallbackResults.filter(article => {
      if (!article) return false;
      const text = `${article.title ?? ""} ${article.content ?? ""}`.toLowerCase();
      return !errorKeywords.some(keyword => text.includes(keyword));
    });

    // Map to only the required fields, after filtering out null/undefined
    const sanitizedArticles = fallbackResults
      .filter((article): article is NonNullable<typeof article> => !!article)
      .map(article => ({
        title: article.title ?? "",
        source: article.source ?? "",
        thumbnail: article.thumbnail ?? "",
        publishDate: article.publishDate ?? "",
        content: article.content ?? "",
      }));

    if (!sanitizedArticles || sanitizedArticles.length === 0) {
      jobStore.setError(jobId, "Oxylabs fallback returned no usable data");
      jobStore.updateStatus(jobId, "failed", "Fallback extraction empty");
      return false;
    }

    jobStore.setResult(jobId, {
      finalUrl: url,
      extractedData: { articles: sanitizedArticles },
      rawText: sanitizedArticles
        .map((a) => [a.title, a.content].filter(Boolean).join("\n"))
        .join("\n\n"),
      goalAssessment: {
        meetsGoal: true,
        confidence: "medium",
        reason: `Extracted ${sanitizedArticles.length} result(s) via Oxylabs fallback after browser flow failed to satisfy goal.`,
        missingRequirements: [],
      },
      trace: [],
    });

    jobStore.updateStatus(jobId, "succeeded", `Fallback extraction completed (${sanitizedArticles.length} result(s))`);
    return true;
  } catch (fallbackErr) {
    const msg = maskError(fallbackErr);
    jobStore.setError(jobId, `Oxylabs fallback threw an error: ${msg}`);
    jobStore.updateStatus(jobId, "failed", "Fallback extraction failed");
    return false;
  }
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
    let confirmedLoggedIn = false;
    let validationRetryStreak = 0;

    jobStore.updateStatus(jobId, "running", "Browser session starting");

    let session: Awaited<ReturnType<typeof createBrowserSession>> | null = null;

    try {
      session = await withTimeout(
        createBrowserSession(job.request.userAgent),
        env.extractionTimeoutMs,
        "create browser session",
      );
      await withTimeout(
        session.page.goto(job.request.url, { waitUntil: "domcontentloaded" }),
        env.extractionTimeoutMs,
        "initial page navigation",
      );

      if (job.request.sourceType === "otter") {
        if ((job.request.loginFields?.length ?? 0) === 0) {
          throw new Error("Otter jobs require login credentials");
        }

        jobStore.updateProgress(jobId, 0, "Logging in to Otter");
        await withTimeout(
          performOtterLoginFlow(session.page, job.request.url, job.request.loginFields ?? []),
          env.extractionTimeoutMs,
          "otter login flow",
        );

        const result = await withTimeout(
          extractResult(session.page, trace, job.request.extractionSchema, job.request.goal, "otter"),
          env.extractionTimeoutMs,
          "otter extraction",
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

          let action = await withTimeout(getNextAction(context, trace), env.aiTimeoutMs, "next action planning");
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

          // Handle "Access is temporarily restricted" done action up to 3 times, then trigger fallback
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

              await session.page.waitForTimeout(2000);
              stepExecutionFailed = true;
              break;
            }

            // All retries exhausted — try Oxylabs fallback
            console.log(`🚨 Triggering fallback after ${MAX_TEMP_RESTRICTED_DONE_RETRIES} temporary-restricted retries`);
            await closeBrowserSession(session);
            session = null;
            await attemptFallback(jobId, job.request.url, jobStore);
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
              const interimResult = await withTimeout(
                extractResult(
                  session.page,
                  trace,
                  job.request.extractionSchema,
                  job.request.goal,
                  job.request.sourceType ?? "generic",
                ),
                env.extractionTimeoutMs,
                "interim extraction",
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
        const result = await withTimeout(
          extractResult(
            session.page,
            trace,
            job.request.extractionSchema,
            job.request.goal,
            job.request.sourceType ?? "generic",
          ),
          env.extractionTimeoutMs,
          "final extraction",
        );

        if (result.goalAssessment && result.goalAssessment.meetsGoal) {
          jobStore.setError(jobId, ""); // Clear any previous error
          jobStore.setResult(jobId, result);
          jobStore.updateStatus(jobId, "succeeded", "Scrape completed");
        } else {
          // Goal not met after full browser run — try Oxylabs fallback
          console.log("🚨 Browser flow goal not met after max steps — triggering Oxylabs fallback");

          if (session) {
            await closeBrowserSession(session);
            session = null;
          }
          await attemptFallback(jobId, job.request.url, jobStore);
        }
      }
    } catch (error) {
      // Unexpected top-level failure — attempt fallback before marking as failed
      const errMsg = maskError(error);
      console.log(`🚨 Top-level browser error: ${errMsg} — triggering Oxylabs fallback`);

      if (session) {
        try {
          await closeBrowserSession(session);
        } catch {
          // ignore close errors at this point
        }
        session = null;
      }
      await attemptFallback(jobId, job.request.url, jobStore);
    } finally {
      if (session) {
        await withTimeout(closeBrowserSession(session), env.teardownTimeoutMs, "close browser session");
      }
    }
  };
}
