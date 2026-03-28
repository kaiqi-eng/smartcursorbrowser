# Smart Cursor Browser Backend

AI-agent backend service for scraping dynamic and authenticated websites by driving a real browser with Playwright and OpenAI visual reasoning.

## What It Does

- Accepts async scrape jobs with `url`, `goal`, optional login fields, and extraction schema.
- Uses a browser session to navigate dynamic pages that traditional HTML scraping cannot capture.
- Uses OpenAI in a step-by-step visual loop to decide navigation actions (click, type, wait, scroll).
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

3. Set `OPENAI_API_KEY` in `.env`.

4. Start dev server:

```bash
npm run dev
```

5. Open Swagger:

- [http://localhost:3000/docs](http://localhost:3000/docs)
- OpenAPI JSON: [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json)

## API Endpoints

- `POST /jobs` - create async scrape job
- `GET /jobs/:id` - check status/progress
- `GET /jobs/:id/result` - fetch result when completed
- `POST /jobs/:id/cancel` - request cancellation

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

## Test

```bash
npm test
```
