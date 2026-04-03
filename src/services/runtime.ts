import { JobQueue } from "./jobQueue";
import { JobStore } from "./jobStore";
import { createScrapeWorker } from "../workers/scrapeWorker";
import { env } from "../config/env";

export class RuntimeServices {
  readonly jobStore: JobStore;
  readonly jobQueue: JobQueue;

  constructor() {
    this.jobStore = new JobStore();
    const worker = createScrapeWorker(this.jobStore);
    this.jobQueue = new JobQueue(worker);

    // New: periodic cleanup to prevent memory leaks
    setInterval(() => {
      this.jobStore.cleanup(env.finishedJobTtlMs);
    }, env.cleanupIntervalMs).unref();
  }
}