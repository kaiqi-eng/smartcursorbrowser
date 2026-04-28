import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env";
import { runOxylabsFallback } from "../src/services/fallback/oxylabsFallback";

const originalEnv = {
  oxylabsUsername: env.oxylabsUsername,
  oxylabsPassword: env.oxylabsPassword,
  oxylabsRequestTimeoutMs: env.oxylabsRequestTimeoutMs,
  oxylabsArticleFetchTimeoutMs: env.oxylabsArticleFetchTimeoutMs,
};

function neverSettlingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason ?? new Error(`Fetch aborted for ${String(input)}`));
    });
  });
}

describe("runOxylabsFallback", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    env.oxylabsUsername = "user";
    env.oxylabsPassword = "pass";
    env.oxylabsRequestTimeoutMs = 20;
    env.oxylabsArticleFetchTimeoutMs = 20;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    env.oxylabsUsername = originalEnv.oxylabsUsername;
    env.oxylabsPassword = originalEnv.oxylabsPassword;
    env.oxylabsRequestTimeoutMs = originalEnv.oxylabsRequestTimeoutMs;
    env.oxylabsArticleFetchTimeoutMs = originalEnv.oxylabsArticleFetchTimeoutMs;
  });

  it("aborts a stalled Oxylabs submission request", async () => {
    vi.stubGlobal("fetch", vi.fn(neverSettlingFetch));

    const startedAt = Date.now();
    const result = await runOxylabsFallback("https://example.com");

    expect(result).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not let stalled sub-article fetches block landing page results", async () => {
    const landingHtml = `
      <html>
        <head><title>Landing Title</title></head>
        <body>
          <article>
            <p>This landing page paragraph is long enough to be extracted as article content for the fallback result.</p>
            <a href="https://example.com/articles/slow-story">Slow story</a>
          </article>
        </body>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://data.oxylabs.io/v1/queries") {
          return Response.json({ id: "query-id" });
        }
        if (url === "https://data.oxylabs.io/v1/queries/query-id/results") {
          return new Response(JSON.stringify({ results: [{ content: landingHtml }] }));
        }
        return neverSettlingFetch(input, init);
      }),
    );

    const startedAt = Date.now();
    const result = await runOxylabsFallback("https://example.com");

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Landing Title");
  });
});
