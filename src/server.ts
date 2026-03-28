import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { requireApiKey } from "./middleware/apiKeyAuth";
import { apiRateLimit } from "./middleware/rateLimit";
import { createDocsRouter } from "./routes/docs";
import { createJobsRouter } from "./routes/jobs";
import { RuntimeServices } from "./services/runtime";

export function createApp(runtime = new RuntimeServices()) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(apiRateLimit);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "smartcursorbrowser" });
  });

  app.use(createDocsRouter());
  app.use(requireApiKey);
  app.use("/jobs", createJobsRouter(runtime));

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message });
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = createApp();
  app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${env.port}`);
  });
}
