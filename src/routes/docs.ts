import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "../docs/openapi";

export function createDocsRouter(): Router {
  const router = Router();
  router.get("/openapi.json", (_req, res) => {
    res.json(openApiSpec);
  });
  router.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
  return router;
}
