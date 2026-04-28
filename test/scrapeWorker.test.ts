import { beforeEach, describe, expect, it, vi } from "vitest";
import type { JobRecord } from "../src/types/job";

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
import { createScrapeWorker } from "../src/workers/scrapeWorker";

describe("scrapeWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
