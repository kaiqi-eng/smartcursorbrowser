import { describe, expect, it } from "vitest";
import { validateOtterTranscriptRequest } from "../src/validation/otterTranscriptRequest";

describe("validateOtterTranscriptRequest", () => {
  it("accepts valid otter transcript payload with credentials", () => {
    const result = validateOtterTranscriptRequest({
      url: "https://otter.ai/u/example?tab=chat&view=transcript",
      email: "user@example.com",
      password: "12345678",
    });
    expect(result.url).toContain("otter.ai");
    expect(result.email).toBe("user@example.com");
  });

  it("rejects non-otter URLs", () => {
    expect(() =>
      validateOtterTranscriptRequest({
        url: "https://example.com/path",
      }),
    ).toThrow(/otter\.ai/i);
  });

  it("rejects payload when credentials are missing", () => {
    expect(() =>
      validateOtterTranscriptRequest({
        url: "https://otter.ai/u/example?tab=chat&view=transcript",
      }),
    ).toThrow();
  });
});
