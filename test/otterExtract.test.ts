import { describe, expect, it, vi } from "vitest";
import { extractOtterSummaryAndTranscript } from "../src/services/extraction/otterExtract";

describe("extractOtterSummaryAndTranscript", () => {
  it("prefers clipboard summary and keeps API transcript formatting", async () => {
    const copyButton = {
      count: vi.fn(async () => 1),
      click: vi.fn(async () => undefined),
    };
    const page = {
      waitForLoadState: vi.fn(async () => undefined),
      waitForTimeout: vi.fn(async () => undefined),
      goto: vi.fn(async () => undefined),
      url: vi.fn(() => "https://otter.ai/u/mockId?tab=chat&view=transcript"),
      context: vi.fn(() => ({
        grantPermissions: vi.fn(async () => undefined),
      })),
      request: {
        get: vi.fn(async () => ({
          json: async () => ({
            speech: {
              title: "Ahad's Meeting Notes",
              summary: "RSS feed, HTML parsing",
              transcripts: [
                { start_offset: 80000, transcript: "Okay. So,", label: "0" },
                { start_offset: 176000, transcript: "I have changed the code.", label: "1" },
              ],
            },
          }),
        })),
      },
      evaluate: vi.fn(async () => "Summary copied from clipboard"),
      locator: vi.fn((selector: string) => {
        if (selector === "body") {
          return {
            innerText: vi.fn(async () => "Summary\nIn this meeting we discussed launch plans."),
          };
        }
        return {
          first: vi.fn(() => copyButton),
        };
      }),
    };

    const result = await extractOtterSummaryAndTranscript(page as never);
    expect(result.summary).toBe("Summary copied from clipboard");
    expect(result.transcript).toContain("Transcript Preview");
    expect(result.transcript).toContain("Unknown Speaker  0:05");
    expect(result.transcript).toContain("Speaker 1  0:11");
    expect(result.transcript).toContain("I have changed the code.");
  });
});
