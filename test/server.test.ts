import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server";
import { env } from "../src/config/env";
import { JobStore } from "../src/services/jobStore";
import type { RuntimeServices } from "../src/services/runtime";

describe("server", () => {
  process.env.SERVICE_API_KEY = "test-api-key";
  env.serviceApiKey = "test-api-key";

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
    const response = await request(app).post("/jobs").set("x-api-key", "test-api-key").send({
      url: "https://example.com",
      goal: "Navigate and extract headline text.",
      maxSteps: 5,
    });
    expect(response.status).toBe(202);
    expect(response.body.jobId).toBeDefined();
  });

  it("rejects jobs request without API key", async () => {
    const app = createApp(createTestRuntime());
    const response = await request(app).post("/jobs").send({
      url: "https://example.com",
      goal: "Navigate and extract headline text.",
    });
    expect(response.status).toBe(401);
  });

  it("accepts otter transcript jobs and redacts credentials", async () => {
    const app = createApp(createTestRuntime());
    const response = await request(app).post("/jobs/otter-transcript").set("x-api-key", "test-api-key").send({
      url: "https://otter.ai/u/example?tab=chat&view=transcript",
      email: "user@example.com",
      password: "12345678",
    });
    expect(response.status).toBe(202);
    expect(response.body.jobId).toBeDefined();
    expect(response.body.request.sourceType).toBe("otter");
    expect(response.body.request.loginFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "email", value: expect.stringMatching(/^\*+/) }),
        expect.objectContaining({ name: "password", value: expect.stringMatching(/^\*+/) }),
      ]),
    );
  });

  it("rejects otter transcript jobs without credentials", async () => {
    const app = createApp(createTestRuntime());
    const response = await request(app).post("/jobs/otter-transcript").set("x-api-key", "test-api-key").send({
      url: "https://otter.ai/u/example?tab=chat&view=transcript",
    });
    expect(response.status).toBe(400);
  });
});
