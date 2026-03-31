/**
 * Local manual script: `npx tsx test/manualOtterPayloadCustom.ts`
 * Replace url, email, and password with your own values before running.
 */
import request from "supertest";
import { env } from "../src/config/env";
import { createApp } from "../src/server";
import { RuntimeServices } from "../src/services/runtime";

async function run(): Promise<void> {
  process.env.SERVICE_API_KEY = "test-api-key";
  env.serviceApiKey = "test-api-key";

  const runtime = new RuntimeServices();
  const app = createApp(runtime);

  const createRes = await request(app).post("/jobs/otter-transcript").set("x-api-key", "test-api-key").send({
    url: "https://otter.ai/u/example?tab=chat&view=transcript",
    email: "user@example.com",
    password: "correct-horse-battery-staple",
  });
  const jobId = createRes.body?.jobId;
  if (!jobId) {
    console.log(JSON.stringify({ createStatus: createRes.status, createBody: createRes.body }, null, 2));
    return;
  }

  for (let i = 0; i < 90; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statusRes = await request(app).get(`/jobs/${jobId}`).set("x-api-key", "test-api-key");
    const status = statusRes.body?.status;
    if (!["succeeded", "failed", "cancelled"].includes(status)) {
      continue;
    }
    const resultRes = await request(app).get(`/jobs/${jobId}/result`).set("x-api-key", "test-api-key");
    console.log(JSON.stringify({ status, jobError: statusRes.body?.error, result: resultRes.body }, null, 2));
    return;
  }
  console.log(JSON.stringify({ error: "Timed out waiting for job completion", jobId }, null, 2));
}

void run();
