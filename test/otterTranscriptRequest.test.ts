import { describe, expect, it } from "vitest";
import { validateOtterTranscriptRequest } from "../src/validation/otterTranscriptRequest";

describe("validateOtterTranscriptRequest", () => {
  it("accepts valid otter transcript payload with URL only", () => {
    const result = validateOtterTranscriptRequest({
      url: "https://otter.ai/u/example?tab=chat&view=transcript",
    });
    expect(result.url).toContain("otter.ai");
    expect(result.email).toBeUndefined();
  });

  it("rejects non-otter URLs", () => {
    expect(() =>
      validateOtterTranscriptRequest({
        url: "https://example.com/path",
      }),
    ).toThrow(/otter\.ai/i);
  });

  it("rejects payload when only one credential is provided", () => {
    expect(() =>
      validateOtterTranscriptRequest({
        url: "https://otter.ai/u/example?tab=chat&view=transcript",
        email: "user@example.com",
      }),
    ).toThrow(/email and password must be provided together/i);
  });
});
