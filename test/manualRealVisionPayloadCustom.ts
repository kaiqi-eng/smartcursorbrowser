import request from "supertest";
import { env } from "../src/config/env";
import { createApp } from "../src/server";
import { RuntimeServices } from "../src/services/runtime";

async function run(): Promise<void> {
  process.env.SERVICE_API_KEY = "test-api-key";
  env.serviceApiKey = "test-api-key";

  const username = process.env.RV_USER ?? "";
  const password = process.env.RV_PASS ?? "";
  if (!username || !password) {
    console.log(JSON.stringify({ error: "Missing RV_USER or RV_PASS environment variable" }, null, 2));
    return;
  }

  const runtime = new RuntimeServices();
  const app = createApp(runtime);

  const createRes = await request(app)
    .post("/jobs")
    .set("x-api-key", "test-api-key")
    .send({
      url: "https://www.realvision.com/",
      goal: "Log in and extract all posts visible in the Real Vision feed.",
      loginFields: [
        { name: "username", selector: "#username", value: username },
        { name: "password", selector: "#password", value: password, secret: true },
      ],
      maxSteps: 40,
      timeoutMs: 240000,
    });

  const jobId = createRes.body?.jobId;
  if (!jobId) {
    console.log(JSON.stringify({ createStatus: createRes.status, createBody: createRes.body }, null, 2));
    return;
  }

  for (let i = 0; i < 260; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const statusRes = await request(app).get(`/jobs/${jobId}`).set("x-api-key", "test-api-key");
    const status = statusRes.body?.status;
    if (!["succeeded", "failed", "cancelled"].includes(status)) {
      continue;
    }
    const resultRes = await request(app).get(`/jobs/${jobId}/result`).set("x-api-key", "test-api-key");
    console.log(
      JSON.stringify(
        {
          status,
          progress: statusRes.body?.progressMessage,
          jobError: statusRes.body?.error,
          result: resultRes.body,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(JSON.stringify({ error: "Timed out waiting for job completion", jobId }, null, 2));
}

void run();
