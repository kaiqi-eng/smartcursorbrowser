import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server";
import { JobStore } from "../src/services/jobStore";
import type { RuntimeServices } from "../src/services/runtime";

describe("server", () => {
  function createTestRuntime() {
    const jobStore = new JobStore();
    return {
      jobStore,
      jobQueue: {
        enqueue: () => undefined,
      },
    } as unknown as RuntimeServices;
  }

  it("serves health endpoint", async () => {
    const app = createApp(createTestRuntime());
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("serves openapi spec", async () => {
    const app = createApp(createTestRuntime());
    const response = await request(app).get("/openapi.json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe("3.0.3");
  });

  it("accepts scrape job requests", async () => {
    const app = createApp(createTestRuntime());
    const response = await request(app).post("/jobs").send({
      url: "https://example.com",
      goal: "Navigate and extract headline text.",
      maxSteps: 5,
    });
    expect(response.status).toBe(202);
    expect(response.body.jobId).toBeDefined();
  });
});
