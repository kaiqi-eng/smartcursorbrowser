export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Smart Cursor Browser API",
    version: "1.0.0",
    description:
      "Async AI-agent browser scraping service for dynamic/authenticated websites. The worker retries failed actions up to 3 times by feeding the last execution error back into the model, and normalizes common selector patterns such as :contains(...) to :has-text(...).",
  },
  servers: [{ url: "http://localhost:3000" }],
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        responses: {
          "200": {
            description: "Service status",
          },
        },
      },
    },
    "/jobs": {
      post: {
        summary: "Create scrape job",
        description:
          "Creates an async browser-agent job. During execution, each failed action is retried (up to 3 attempts) with error-aware replanning, and common jQuery-like selectors are normalized for Playwright compatibility.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateJobRequest" },
              examples: {
                loginDynamicNews: {
                  summary: "Login and scrape dynamic page",
                  value: {
                    url: "https://example.com/login",
                    goal: "Login and extract latest three news headlines from dashboard.",
                    loginFields: [
                      { name: "username", selector: "#username", value: "demo-user" },
                      { name: "password", selector: "#password", value: "secret-pass", secret: true },
                    ],
                    extractionSchema: {
                      headline1: ".news-item:nth-child(1) h2",
                      headline2: ".news-item:nth-child(2) h2",
                      headline3: ".news-item:nth-child(3) h2",
                    },
                    maxSteps: 20,
                  },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Job accepted",
          },
          "400": {
            description: "Invalid request payload",
          },
        },
      },
    },
    "/jobs/otter-transcript": {
      post: {
        summary: "Create Otter transcript extraction job",
        description:
          "Queues a deterministic Otter flow that logs in and extracts transcript plus meeting summary. Credentials are accepted in request body and redacted in echoed response.",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OtterTranscriptRequest" },
              examples: {
                otterTranscript: {
                  summary: "Otter transcript extraction",
                  value: {
                    url: "https://otter.ai/u/example?tab=chat&view=transcript",
                    email: "user@example.com",
                    password: "correct-horse-battery-staple",
                    maxSteps: 8,
                  },
                },
              },
            },
          },
        },
        responses: {
          "202": { description: "Job accepted" },
          "400": { description: "Invalid request payload" },
        },
      },
    },
    "/jobs/{id}": {
      get: {
        summary: "Get job status",
        description:
          "Returns lifecycle status and progress. If retries occur, progress messages and final error will reflect retry attempts and action-level failures.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Current job status" },
          "404": { description: "Not found" },
        },
      },
    },
    "/jobs/{id}/result": {
      get: {
        summary: "Get final job result",
        description:
          "Returns extracted data and execution trace. Trace notes include attempt markers (for example '[attempt 2]') when action retries were needed.",
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Result payload" },
          "409": { description: "Result not ready yet" },
          "404": { description: "Not found" },
        },
      },
    },
    "/jobs/{id}/cancel": {
      post: {
        summary: "Cancel running job",
        security: [{ ApiKeyAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "202": { description: "Cancel accepted" },
          "404": { description: "Not found" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
      },
    },
    schemas: {
      CreateJobRequest: {
        type: "object",
        required: ["url", "goal"],
        properties: {
          url: { type: "string", format: "uri" },
          goal: { type: "string", example: "Login and gather latest five article titles." },
          extractionSchema: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          loginFields: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "value"],
              properties: {
                name: { type: "string", example: "username" },
                selector: { type: "string", example: "#username" },
                value: { type: "string", example: "my-user" },
                secret: { type: "boolean", example: true },
              },
            },
          },
          webhookUrl: {
            type: "string",
            format: "uri",
            example: "https://your-app.example/webhooks/scrape-finished",
            description: "Completion webhook URL. Must use https.",
          },
          callbackUrl: {
            type: "string",
            format: "uri",
            example: "https://your-app.example/webhooks/scrape-finished",
            description: "Alias of webhookUrl for backwards compatibility.",
          },
          maxSteps: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 900000, default: 120000 },
        },
      },
      OtterTranscriptRequest: {
        type: "object",
        required: ["url", "email", "password"],
        properties: {
          url: { type: "string", format: "uri", example: "https://otter.ai/u/example?tab=chat&view=transcript" },
          email: { type: "string", format: "email", example: "user@example.com" },
          password: {
            type: "string",
            format: "password",
            minLength: 8,
          },
          maxSteps: { type: "integer", minimum: 1, maximum: 100, default: 8 },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 900000, default: 120000 },
          userAgent: { type: "string", example: "Mozilla/5.0" },
        },
      },
    },
  },
} as const;
