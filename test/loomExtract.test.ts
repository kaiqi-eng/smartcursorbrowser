import { describe, expect, it } from "vitest";
import {
  buildLoomSummary,
  parseJsonTranscript,
  parseLoomVideoId,
  parseVttTranscript,
} from "../src/services/extraction/loomExtract";

describe("loomExtract helpers", () => {
  it("parses Loom share and embed video ids", () => {
    expect(parseLoomVideoId("https://www.loom.com/share/0123456789abcdef0123456789abcdef")).toBe(
      "0123456789abcdef0123456789abcdef",
    );
    expect(parseLoomVideoId("https://www.loom.com/embed/fedcba9876543210fedcba9876543210")).toBe(
      "fedcba9876543210fedcba9876543210",
    );
  });

  it("formats transcript segments from JSON payloads", () => {
    const transcript = parseJsonTranscript({
      transcript: [
        { startSeconds: 1, endSeconds: 3, text: "Hello from Loom." },
        { start_seconds: 4, end_seconds: 7, transcript: "This is the second caption." },
      ],
    });

    expect(transcript).toContain("Transcript");
    expect(transcript).toContain("0:01");
    expect(transcript).toContain("Hello from Loom.");
    expect(transcript).toContain("0:04");
    expect(transcript).toContain("This is the second caption.");
  });

  it("formats transcript segments from VTT captions", () => {
    const transcript = parseVttTranscript(`WEBVTT

00:00:01.000 --> 00:00:03.000
First caption.

00:00:04.000 --> 00:00:06.000
Second caption.
`);

    expect(transcript).toContain("0:01");
    expect(transcript).toContain("First caption.");
    expect(transcript).toContain("0:04");
    expect(transcript).toContain("Second caption.");
  });

  it("builds summary from description and JSON chapters", () => {
    const summary = buildLoomSummary(
      "Walkthrough of the release.",
      JSON.stringify([
        { startSeconds: 0, title: "Intro" },
        { startSeconds: 75, title: "Demo" },
      ]),
    );

    expect(summary).toContain("Walkthrough of the release.");
    expect(summary).toContain("Chapters");
    expect(summary).toContain("0:00 Intro");
    expect(summary).toContain("1:15 Demo");
  });

  it("supports description-only and chapters-only summaries", () => {
    expect(buildLoomSummary("Only a description.", "")).toBe("Only a description.");
    expect(buildLoomSummary("", "0:00 Intro")).toBe("Chapters\n0:00 Intro");
  });
});
