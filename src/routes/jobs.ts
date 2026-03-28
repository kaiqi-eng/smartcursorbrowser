import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import type { RuntimeServices } from "../services/runtime";
import { redactLoginFields } from "../services/security/redaction";
import type { JobRecord, JobSummary } from "../types/job";
import { validateScrapeJobRequest } from "../validation/jobRequest";

function toSummary(job: JobRecord): JobSummary {
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    progress: job.progress,
    error: job.error,
  };
}

export function createJobsRouter(runtime: RuntimeServices): Router {
  const router = Router();

  router.post("/", (req, res) => {
    try {
      const payload = validateScrapeJobRequest(req.body);
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
