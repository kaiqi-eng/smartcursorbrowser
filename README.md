# Smart Cursor Browser Backend

AI-agent backend service for scraping dynamic and authenticated websites by driving a real browser with Playwright and OpenAI visual reasoning.

## What It Does

- Accepts async scrape jobs with `url`, `goal`, optional login fields, and extraction schema.
- Uses a browser session to navigate dynamic pages that traditional HTML scraping cannot capture.
- Uses OpenAI in a step-by-step visual loop to decide navigation actions (click, type, wait, scroll).
- Automatically retries failed actions up to 3 times by feeding the action error back into the AI for a new step.
- Normalizes common non-Playwright selectors (for example `:contains("Login")`) into Playwright-compatible selectors.
- Exposes Swagger UI for manual API testing.

## Requirements

- Node.js 20+
- Playwright browser dependencies (installed via package)
- OpenAI API key

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy env template:

```bash
copy .env.example .env
```

3. Set `SERVICE_API_KEY` and `OPENAI_API_KEY` in `.env`.

4. Start dev server:

```bash
npm run dev
```

5. Open Swagger:

- [http://localhost:3000/docs](http://localhost:3000/docs)
- OpenAPI JSON: [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)
- In Swagger, click **Authorize** and set `x-api-key` to your `SERVICE_API_KEY`.
- Frontend UI: [http://localhost:3000/app](http://localhost:3000/app)

## API Endpoints

- `POST /jobs` - create async scrape job
- `GET /jobs/:id` - check status/progress
- `GET /jobs/:id/result` - fetch result when completed
- `GET /jobs/:id/live-image` - latest screenshot + page metadata for live view
- `POST /jobs/:id/cancel` - request cancellation

All `/jobs` endpoints require header `x-api-key: <SERVICE_API_KEY>`.

## Example Job Request

```json
{
  "url": "https://example.com/login",
  "goal": "Login and extract latest 3 headlines from dashboard",
  "loginFields": [
    { "name": "username", "selector": "#username", "value": "demo-user" },
    { "name": "password", "selector": "#password", "value": "my-pass", "secret": true }
  ],
  "maxSteps": 20
}
```

## Security Notes

- Credentials are request-scoped and not persisted.
- Login secrets are redacted in API echoes and error reporting.
- Jobs have timeout/step limits to control runaway automation.

## Result Format

`GET /jobs/:id/result` includes both raw and structured extraction:

- `rawText`: captured text from the page
- `parsedPosts`: AI-parsed array with minimal rewriting

Example:

```json
{
  "parsedPosts": [
    {
      "title": "Post title from source",
      "content": "Post content copied as closely as possible from source text."
    }
  ]
}
```

## Deploy To Render

This repo includes `render.yaml` for Blueprint deploy.

1. Push repo to GitHub.
2. In Render, create a new **Blueprint** service from this repo.
3. Render will detect `render.yaml` and create the web service.
4. Set secret env vars in Render dashboard:
   - `SERVICE_API_KEY`
   - `OPENAI_API_KEY`
5. Deploy and verify health endpoint:
   - `https://<your-render-service>/health`

Notes:

- Build installs Playwright Chromium (`npx playwright install chromium`) from `render.yaml`.
- Render uses `PLAYWRIGHT_BROWSERS_PATH=/opt/render/project/src/.playwright` so browser binaries are installed and resolved from the same app directory.
- Use `https://<your-render-service>/docs` for Swagger and `https://<your-render-service>/app` for the UI.
- Use `x-api-key` header (your `SERVICE_API_KEY`) for all `/jobs` routes.

## Test

```bash
npm test
```
