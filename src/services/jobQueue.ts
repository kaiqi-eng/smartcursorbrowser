export type JobHandler = (jobId: string) => Promise<void>;

export class JobQueue {
  private readonly pending: string[] = [];
  private running = false;

  constructor(private readonly handler: JobHandler) {}

  enqueue(jobId: string): void {
    this.pending.push(jobId);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const jobId = this.pending.shift();
        if (!jobId) {
          continue;
        }
        await this.handler(jobId);
      }
    } finally {
      this.running = false;
    }
  }
}
