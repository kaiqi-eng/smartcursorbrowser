import { describe, expect, it, vi } from "vitest";
import { JobQueue } from "../src/services/jobQueue";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 500) {
      throw new Error("Timed out waiting for queue condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("JobQueue", () => {
  it("processes enqueued jobs in FIFO order", async () => {
    const processed: string[] = [];
    const queue = new JobQueue(async (jobId) => {
      processed.push(jobId);
    });

    queue.enqueue("first");
    queue.enqueue("second");
    queue.enqueue("third");

    await waitForCondition(() => processed.length === 3);

    expect(processed).toEqual(["first", "second", "third"]);
  });

  it("does not run more than one handler at a time", async () => {
    const firstJob = createDeferred();
    const secondJob = createDeferred();
    const started: string[] = [];
    const finished: string[] = [];

    const queue = new JobQueue(
      vi.fn(async (jobId) => {
        started.push(jobId);
        if (jobId === "first") {
          await firstJob.promise;
        }
        if (jobId === "second") {
          await secondJob.promise;
        }
        finished.push(jobId);
      }),
    );

    queue.enqueue("first");
    await waitForCondition(() => started.includes("first"));

    queue.enqueue("second");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(started).toEqual(["first"]);
    expect(finished).toEqual([]);

    firstJob.resolve();
    await waitForCondition(() => started.includes("second"));

    expect(finished).toEqual(["first"]);
    expect(started).toEqual(["first", "second"]);

    secondJob.resolve();
    await waitForCondition(() => finished.includes("second"));

    expect(finished).toEqual(["first", "second"]);
  });
});
