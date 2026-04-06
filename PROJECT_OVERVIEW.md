# Smart Cursor Browser: Project Overview

This document explains the full project at a system level: what it does, how requests move through the app, and where each major module fits.

## 1) What this project is

`smartcursorbrowser` is an async scraping backend that uses:

- **Express** for API endpoints
- **Playwright** for real browser automation
- **OpenAI** for action planning and extraction validation

The service is designed for pages that static HTML scraping cannot handle (logged-in flows, dynamic feeds, lazy-loaded content, in-app navigation).

## 2) High-level architecture

The runtime is intentionally simple and in-memory:

1. API receives a job (`POST /jobs` or `POST /jobs/otter-transcript`).
2. Request is validated and normalized.
3. A `JobRecord` is created in `JobStore` (in-memory map).
4. Job ID is enqueued into `JobQueue` (single-process FIFO worker).
5. `scrapeWorker` runs the browser loop, updates live status, and writes final result.
6. Clients poll status/result endpoints.

Core composition starts in:

- `src/server.ts` (Express app + middleware + routes)
- `src/services/runtime.ts` (`JobStore` + `JobQueue` + worker wiring)

## 3) Runtime data model

Types are centralized in `src/types/job.ts`.

Important entities:

- `ScrapeJobRequest`: input configuration (url, goal, loginFields, extractionSchema, sourceType, limits)
- `JobRecord`: full lifecycle state for a job
- `ScrapeResult`: extraction output + goal assessment + trace
- `JobTraceEvent`: step-by-step action record with notes

Job statuses:

- `queued` -> `running` -> terminal (`succeeded`, `failed`, `cancelled`)

## 4) Request lifecycle (generic scrape job)

### A. API creation

- Route: `POST /jobs` in `src/routes/jobs.ts`
- Validation: `validateScrapeJobRequest` in `src/validation/jobRequest.ts`
- Security checks:
  - target domain allow-list (`ALLOWED_DOMAINS`, optional)
  - `webhookUrl` must be `https` if provided

### B. Queue + worker execution

- Queue implementation: `src/services/jobQueue.ts` (single concurrent worker)
- Worker logic: `src/workers/scrapeWorker.ts`

Worker loop per step:

1. Capture current context (`textSnapshot`, optional screenshot, URL/title).
2. Ask model for next action via `getNextAction(...)`.
3. Execute action via Playwright wrappers in `executeBrowserAction(...)`.
4. Retry failed actions up to `MAX_ACTION_RETRIES`.
5. If model says `done`/`extract`, run extraction and validate goal.
6. Continue or finish based on `goalAssessment`, max steps, timeout, or cancel request.

### C. Final extraction

- Main function: `extractResult(...)` in `src/services/extraction/extract.ts`
- Produces `rawText`, optional selector-based `extractedData`, parsed posts, validation payload, and goal assessment.
- Full extraction notes are documented in `src/services/extraction/README.md`.

### D. Client polling and retrieval

- `GET /jobs/:id` -> status/progress
- `GET /jobs/:id/live-image` -> latest screenshot + URL/title + validation payload
- `GET /jobs/:id/result` -> final `ScrapeResult`

## 5) Otter transcript flow

Specialized endpoint:

- `POST /jobs/otter-transcript`

Differences from generic flow:

- Input is validated by `src/validation/otterTranscriptRequest.ts` and restricted to `otter.ai` URLs.
- Worker runs deterministic login flow (`performOtterLoginFlow`).
- Extraction uses `extractOtterSummaryAndTranscript(...)` to pull summary/transcript from Otter APIs and page fallbacks.
- Returned result emphasizes `summary` + `transcript` instead of generic post parsing output.

## 6) AI integration

### Navigation planner

- `src/services/ai/visualNavigator.ts`
- Uses OpenAI Responses API with:
  - strict JSON action schema
  - optional screenshot input (`input_image`)
  - recent trace + last error for replanning

Output is a `BrowserAction` (`goto`, `click`, `type`, `wait`, `scroll`, `extract`, `done`).

### Post parsing + validation

- `parsePostsFromRawText(...)`: extracts post-like timestamped content
- `validateGoalAgainstExtraction(...)`: determines whether the extraction satisfies the user goal

Both use structured JSON outputs and safe fallback behavior when model calls fail.

## 7) Browser automation layer

Located under `src/services/browser/`.

- `session.ts`: Chromium launch + context creation + resource blocking controls
- `actions.ts`: normalized action executor with selector normalization and credential token resolution (`{{username}}`)
- `loginFlow.ts`: deterministic login helpers and submit strategies
- `otterFlow.ts`: deterministic Otter sign-in workflow
- `blockers.ts`: challenge/captcha/mfa detection utility (currently available as a helper module)

## 8) Security and operational controls

Security middleware and redaction:

- API key auth (`src/middleware/apiKeyAuth.ts`) on `/jobs` routes
- Global rate limit (`src/middleware/rateLimit.ts`)
- Credential redaction in request echoes and webhook payloads (`src/services/security/redaction.ts`)
- Error masking to avoid secret leakage

Operational controls:

- Step and timeout limits
- Retry loops for transient page-context/action failures
- Optional heavy-resource blocking in browser context
- Periodic cleanup of finished in-memory jobs (`JobStore.cleanup`)

## 9) API surface

Routes:

- `GET /health`
- `GET /openapi.json`
- `GET /docs` (Swagger UI)
- `POST /jobs`
- `POST /jobs/otter-transcript`
- `GET /jobs/:id`
- `GET /jobs/:id/result`
- `GET /jobs/:id/live-image`
- `POST /jobs/:id/cancel`

OpenAPI specification source: `src/docs/openapi.ts`.

## 10) Built-in UI

Static UI served from:

- `public/index.html`
- `public/app.js`

Accessible at `/app`, this page lets you:

- submit jobs
- poll live status and screenshots
- cancel jobs
- view final result and validation payload

It is mainly an operator/testing UI rather than a production frontend.

## 11) Configuration

Environment parsing is in `src/config/env.ts`.

Core variables:

- `PORT`
- `SERVICE_API_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `MAX_JOB_STEPS`
- `JOB_TIMEOUT_MS`
- `ALLOWED_DOMAINS`

Additional runtime toggles (defined in code):

- `BROWSER_HEADLESS`
- `ENABLE_LIVE_SCREENSHOTS`
- `SCREENSHOT_EVERY_N_STEPS`
- `MAX_TRACE_EVENTS`
- `MAX_RAW_TEXT_CHARS`
- `FINISHED_JOB_TTL_MS`
- `CLEANUP_INTERVAL_MS`
- `BLOCK_HEAVY_RESOURCES`

Reference baseline file: `.env.example`.

## 12) Local development and test

Commands (from `package.json`):

- `npm install`
- `npm run build`
- `npm run dev`
- `npm test`

Tests use `vitest` and `supertest` (`test/` directory).

Current test focus is API behavior and Otter extraction/validation logic.

## 13) Current constraints and trade-offs

- **In-memory state only**: jobs do not survive process restarts.
- **Single process queue**: no horizontal queue worker distribution out of the box.
- **LLM dependency for planning/validation**: output quality depends on model behavior and prompt alignment.
- **Dynamic-site variability**: login and blocker behavior can differ significantly by target site.

For production scaling, typical next steps are persistent storage, distributed queueing, richer observability, and stronger site-specific adapters.
