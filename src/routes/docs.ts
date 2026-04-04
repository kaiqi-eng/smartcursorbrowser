import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "../docs/openapi";

export function createDocsRouter(): Router {
  const router = Router();
  router.get("/openapi.json", (req, res) => {
    const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
    const protocol = forwardedProto || req.protocol;
    const host = forwardedHost || req.get("host");
    const serverUrl = host ? `${protocol}://${host}` : "http://localhost:3000";

    res.json({
      ...openApiSpec,
      servers: [{ url: serverUrl }],
    });
  });
  router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
      swaggerOptions: {
        url: "/openapi.json",
      },
    }),
  );
  return router;
}
