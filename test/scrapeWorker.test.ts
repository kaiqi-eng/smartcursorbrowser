import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRecord } from "../src/types/job";
import { env } from "../src/config/env";

vi.mock("../src/services/browser/session", () => ({
  closeBrowserSession: vi.fn(async () => undefined),
  createBrowserSession: vi.fn(),
}));

vi.mock("../src/services/fallback/oxylabsFallback", () => ({
  runOxylabsFallback: vi.fn(async () => []),
}));

import { createBrowserSession } from "../src/services/browser/session";
import { runOxylabsFallback } from "../src/services/fallback/oxylabsFallback";
import { JobStore } from "../src/services/jobStore";
import { createScrapeWorker, isMemoryExceeded } from "../src/workers/scrapeWorker";

function createFakeSession() {
  return {
    page: {
      goto: vi.fn(async () => undefined),
    },
    context: {
      close: vi.fn(async () => undefined),
    },
    browser: {
      close: vi.fn(async () => undefined),
    },
  };
}

describe("scrapeWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.memoryGuardEnabled = true;
    env.memoryGuardRssMb = 430;
    env.memoryGuardMaxRetries = 2;
    env.memoryGuardCooldownMs = 1;
  });

  it("returns true when RSS exceeds memory threshold", () => {
    env.memoryGuardEnabled = true;
    env.memoryGuardRssMb = 430;
    expect(isMemoryExceeded(430)).toBe(true);
    expect(isMemoryExceeded(431)).toBe(true);
    expect(isMemoryExceeded(429)).toBe(false);
  });

  it("fails Otter jobs directly instead of invoking Oxylabs fallback", async () => {
    const jobStore = new JobStore();
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: "otter-job",
      status: "queued",
      request: {
        url: "https://otter.ai/u/mock-id",
        goal: "Extract transcript and summary from the Otter transcript page.",
        sourceType: "otter",
        loginFields: [
          { name: "email", value: "user@example.com", secret: true },
          { name: "password", value: "password123", secret: true },
        ],
      },
      createdAt: now,
      updatedAt: now,
      progress: {
        step: 0,
        maxSteps: 8,
        message: "Queued",
      },
      cancelRequested: false,
    };

    jobStore.create(job);
    vi.mocked(createBrowserSession).mockRejectedValue(new Error("browser unavailable"));

    await createScrapeWorker(jobStore)("otter-job");

    const updatedJob = jobStore.get("otter-job");
    expect(runOxylabsFallback).not.toHaveBeenCalled();
    expect(updatedJob?.status).toBe("failed");
    expect(updatedJob?.progress.message).toBe("Otter extraction failed");
    expect(updatedJob?.error).toContain("browser unavailable");
    expect(updatedJob?.result).toBeUndefined();
  });

  it("triggers Oxylabs fallback for generic jobs when memory guard retries are exhausted", async () => {
    const jobStore = new JobStore();
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: "generic-memory-guard-job",
      status: "queued",
      request: {
        url: "https://example.com/feed",
        goal: "Extract latest headlines",
      },
      createdAt: now,
      updatedAt: now,
      progress: {
        step: 0,
        maxSteps: 5,
        message: "Queued",
      },
      cancelRequested: false,
    };

    jobStore.create(job);
    env.memoryGuardMaxRetries = 0;
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 470 * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });

    vi.mocked(createBrowserSession).mockResolvedValue(createFakeSession() as never);
    vi.mocked(runOxylabsFallback).mockResolvedValue([
      { title: "A", content: "B", source: "C", thumbnail: "", publishDate: "" } as never,
    ]);

    await createScrapeWorker(jobStore)("generic-memory-guard-job");

    const updatedJob = jobStore.get("generic-memory-guard-job");
    expect(runOxylabsFallback).toHaveBeenCalledOnce();
    expect(updatedJob?.status).toBe("succeeded");
    vi.restoreAllMocks();
  });

  it("fails otter jobs with memory guard error when retries are exhausted", async () => {
    const jobStore = new JobStore();
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: "otter-memory-guard-job",
      status: "queued",
      request: {
        url: "https://otter.ai/u/mock-id",
        goal: "Extract transcript and summary from the Otter transcript page.",
        sourceType: "otter",
        loginFields: [
          { name: "email", value: "user@example.com", secret: true },
          { name: "password", value: "password123", secret: true },
        ],
      },
      createdAt: now,
      updatedAt: now,
      progress: {
        step: 0,
        maxSteps: 8,
        message: "Queued",
      },
      cancelRequested: false,
    };

    jobStore.create(job);
    env.memoryGuardMaxRetries = 0;
    vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 470 * 1024 * 1024,
      heapTotal: 0,
      heapUsed: 0,
      external: 0,
      arrayBuffers: 0,
    });
    vi.mocked(createBrowserSession).mockResolvedValue(createFakeSession() as never);

    await createScrapeWorker(jobStore)("otter-memory-guard-job");

    const updatedJob = jobStore.get("otter-memory-guard-job");
    expect(runOxylabsFallback).not.toHaveBeenCalled();
    expect(updatedJob?.status).toBe("failed");
    expect(updatedJob?.error).toContain("memory_guard_triggered");
    vi.restoreAllMocks();
  });
});
