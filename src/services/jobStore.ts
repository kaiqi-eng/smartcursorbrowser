import type { JobLiveView, JobRecord, JobStatus, ScrapeResult } from "../types/job";

export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  create(job: JobRecord): void {
    this.jobs.set(job.id, job);
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  updateStatus(id: string, status: JobStatus, message: string): JobRecord | undefined {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }
    job.status = status;
    job.progress.message = message;
    job.updatedAt = new Date().toISOString();
    if (status === "running" && !job.startedAt) {
      job.startedAt = job.updatedAt;
    }
    if (["succeeded", "failed", "cancelled"].includes(status)) {
      job.finishedAt = job.updatedAt;
    }
    return job;
  }

  updateProgress(id: string, step: number, message: string): JobRecord | undefined {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }
    job.progress.step = step;
    job.progress.message = message;
    job.updatedAt = new Date().toISOString();
    return job;
  }

  setResult(id: string, result: ScrapeResult): JobRecord | undefined {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }
    job.result = result;
    job.updatedAt = new Date().toISOString();
    return job;
  }

  updateLiveView(id: string, view: Omit<JobLiveView, "updatedAt">): JobRecord | undefined {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }
    job.liveView = {
      ...view,
      updatedAt: new Date().toISOString(),
    };
    job.updatedAt = job.liveView.updatedAt;
    return job;
  }

  setError(id: string, error: string): JobRecord | undefined {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }
    job.error = error;
    job.updatedAt = new Date().toISOString();
    return job;
  }

  requestCancel(id: string): JobRecord | undefined {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }
    job.cancelRequested = true;
    job.updatedAt = new Date().toISOString();
    job.progress.message = "Cancellation requested";
    return job;
  }
}
