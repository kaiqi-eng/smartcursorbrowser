export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Smart Cursor Browser API",
    version: "1.0.0",
    description: "Async AI-agent browser scraping service for dynamic/authenticated websites.",
  },
  servers: [{ url: "http://localhost:3000" }],
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
    "/jobs/{id}": {
      get: {
        summary: "Get job status",
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
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "202": { description: "Cancel accepted" },
          "404": { description: "Not found" },
        },
      },
    },
  },
  components: {
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
          maxSteps: { type: "integer", minimum: 1, maximum: 100, default: 25 },
          timeoutMs: { type: "integer", minimum: 5000, maximum: 900000, default: 120000 },
        },
      },
    },
  },
} as const;
