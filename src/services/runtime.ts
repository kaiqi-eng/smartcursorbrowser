import { JobQueue } from "./jobQueue";
import { JobStore } from "./jobStore";
import { createScrapeWorker } from "../workers/scrapeWorker";

export class RuntimeServices {
  readonly jobStore: JobStore;
  readonly jobQueue: JobQueue;

  constructor() {
    this.jobStore = new JobStore();
    const worker = createScrapeWorker(this.jobStore);
    this.jobQueue = new JobQueue(worker);
  }
}
