import { describe, expect, it } from "vitest";
import { validateLoomTranscriptRequest } from "../src/validation/loomTranscriptRequest";

describe("validateLoomTranscriptRequest", () => {
  it("accepts valid loom transcript payload with credentials", () => {
    const result = validateLoomTranscriptRequest({
      url: "https://www.loom.com/share/0123456789abcdef0123456789abcdef",
      email: "user@example.com",
      password: "12345678",
    });

    expect(result.url).toContain("loom.com");
    expect(result.email).toBe("user@example.com");
  });

  it("rejects non-loom URLs", () => {
    expect(() =>
      validateLoomTranscriptRequest({
        url: "https://example.com/path",
        email: "user@example.com",
        password: "12345678",
      }),
    ).toThrow(/loom\.com/i);
  });

  it("rejects payload when credentials are missing", () => {
    expect(() =>
      validateLoomTranscriptRequest({
        url: "https://www.loom.com/share/0123456789abcdef0123456789abcdef",
      }),
    ).toThrow();
  });
});
