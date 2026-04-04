import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env";
import type { RuntimeServices } from "../services/runtime";
import { redactLoginFields } from "../services/security/redaction";
import type { JobRecord, JobSummary } from "../types/job";
import { validateScrapeJobRequest } from "../validation/jobRequest";
import { validateOtterTranscriptRequest } from "../validation/otterTranscriptRequest";

function toSummary(job: JobRecord): JobSummary {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
    webhook: {
      urlConfigured: Boolean(job.request.webhookUrl),
      dispatchedAt: job.webhookDispatchedAt,
      dispatchError: job.webhookDispatchError,
    },
  };
}

function isAllowedUrl(url: string): boolean {
  if (env.allowedDomains.length === 0) {
    return true;
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return env.allowedDomains.some((domain) => {
      const normalized = domain.toLowerCase();
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

function isAllowedWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function createJobsRouter(runtime: RuntimeServices): Router {
  const router = Router();

  router.post("/otter-transcript", (req, res) => {
    try {
      const payload = validateOtterTranscriptRequest(req.body);

      if (!isAllowedUrl(payload.url)) {
        res.status(403).json({ error: "Target URL domain is not allowed" });
        return;
      }

      const now = new Date().toISOString();
      const id = uuidv4();
      const job: JobRecord = {
        id,
        status: "queued",
        request: {
          url: payload.url,
          goal: "Extract transcript and summary from the Otter transcript page.",
          sourceType: "otter",
          loginFields: [
            { name: "email", value: payload.email, secret: true },
            { name: "password", value: payload.password, secret: true },
          ],
          maxSteps: payload.maxSteps ?? 8,
          timeoutMs: payload.timeoutMs,
          userAgent: payload.userAgent,
        },
        createdAt: now,
        updatedAt: now,
        progress: {
          step: 0,
          maxSteps: payload.maxSteps ?? 8,
          message: "Queued",
        },
        cancelRequested: false,
      };

      runtime.jobStore.create(job);
      runtime.jobQueue.enqueue(id);

      res.status(202).json({
        jobId: id,
        status: job.status,
        request: {
          url: payload.url,
          maxSteps: payload.maxSteps ?? 8,
          timeoutMs: payload.timeoutMs,
          userAgent: payload.userAgent,
          loginFields: redactLoginFields(job.request.loginFields),
          sourceType: "otter",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      res.status(400).json({ error: message });
    }
  });

  router.post("/", (req, res) => {
    try {
      const payload = validateScrapeJobRequest(req.body);

      if (!isAllowedUrl(payload.url)) {
        res.status(403).json({ error: "Target URL domain is not allowed" });
        return;
      }

      if (payload.webhookUrl && !isAllowedWebhookUrl(payload.webhookUrl)) {
        res.status(400).json({ error: "webhookUrl must be a valid https URL" });
        return;
      }

      const now = new Date().toISOString();
      const id = uuidv4();
      const job: JobRecord = {
        id,
        status: "queued",
        request: payload,
        createdAt: now,
        updatedAt: now,
        progress: {
          step: 0,
          maxSteps: payload.maxSteps ?? 25,
          message: "Queued",
        },
        cancelRequested: false,
      };

      runtime.jobStore.create(job);
      runtime.jobQueue.enqueue(id);

      res.status(202).json({
        jobId: id,
        status: job.status,
        request: {
          ...payload,
          loginFields: redactLoginFields(payload.loginFields),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid request";
      res.status(400).json({ error: message });
    }
  });

  router.get("/:id", (req, res) => {
    const job = runtime.jobStore.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json(toSummary(job));
  });

  router.get("/:id/result", (req, res) => {
    const job = runtime.jobStore.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    if (!job.result) {
      res.status(409).json({
        error: "Result not ready",
        status: job.status,
      });
      return;
    }
    res.json(job.result);
  });

  router.get("/:id/live-image", (req, res) => {
    const job = runtime.jobStore.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      currentUrl: job.liveView?.currentUrl,
      pageTitle: job.liveView?.pageTitle,
      updatedAt: job.liveView?.updatedAt,
      imageDataUrl: job.liveView?.screenshotBase64 ? `data:image/png;base64,${job.liveView.screenshotBase64}` : null,
      validationPayload: job.latestValidationPayload ?? null,
      error: job.error,
    });
  });

  router.post("/:id/cancel", (req, res) => {
    const job = runtime.jobStore.requestCancel(req.params.id);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.status(202).json({
      jobId: job.id,
      status: job.status,
      cancelRequested: job.cancelRequested,
    });
  });

  return router;
}