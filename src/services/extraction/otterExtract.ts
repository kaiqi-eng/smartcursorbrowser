import type { Page } from "playwright";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function joinUnique(lines: string[]): string {
  const seen = new Set<string>();
  const filtered: string[] = [];
  for (const line of lines) {
    const normalized = normalizeWhitespace(line);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    filtered.push(normalized);
  }
  return filtered.join("\n");
}

interface OtterTranscriptItem {
  start_offset?: number;
  transcript?: string;
  label?: string;
}

interface OtterSpeechPayload {
  speech?: {
    title?: string;
    summary?: string;
    short_abstract_summary?: unknown;
    transcripts?: OtterTranscriptItem[];
  };
}

function withSummaryView(url: string): string {
  if (url.includes("view=summary")) {
    return url;
  }
  if (url.includes("view=")) {
    return url.replace(/view=[^&#]*/i, "view=summary");
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}view=summary`;
}

async function readClipboardSummary(page: Page): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://otter.ai" }).catch(() => {});

  const candidateUrls = [page.url(), withSummaryView(page.url())];
  const selectors = [
    "[data-testid='copy-summary']",
    "button[data-testid='copy-summary']",
    "button:has-text('Copy summary')",
    "[aria-label*='copy summary' i]",
  ];

  for (let index = 0; index < candidateUrls.length; index += 1) {
    if (index > 0 && candidateUrls[index] !== page.url()) {
      await page.goto(candidateUrls[index], { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
    }

    for (const selector of selectors) {
      const button = page.locator(selector).first();
      if ((await button.count()) === 0) {
        continue;
      }
      try {
        await button.click({ timeout: 3000 });
        await page.waitForTimeout(250);
        const copied = await page.evaluate(async () => {
          if (!navigator.clipboard?.readText) {
            return "";
          }
          try {
            return (await navigator.clipboard.readText()).trim();
          } catch {
            return "";
          }
        });
        if (copied) {
          return copied;
        }
      } catch {
        // Try next summary selector.
      }
    }
  }

  return "";
}

function formatSeconds(secondsRaw: number): string {
  const seconds = Math.max(0, Math.round(secondsRaw));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = String(seconds % 60).padStart(2, "0");
  return `${minutesPart}:${secondsPart}`;
}

function mapSpeaker(label?: string): string {
  if (!label || label === "0") {
    return "Unknown Speaker";
  }
  const numeric = Number.parseInt(label, 10);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return `Speaker ${numeric}`;
  }
  return "Unknown Speaker";
}

function formatTranscriptFromSpeech(transcripts: OtterTranscriptItem[] = []): string {
  const rows = transcripts
    .map((item) => {
      const speaker = mapSpeaker(item.label);
      const timestamp = formatSeconds((item.start_offset ?? 0) / 16000);
      const text = normalizeWhitespace(item.transcript ?? "");
      if (!text) {
        return "";
      }
      return `${speaker}  ${timestamp}\n${text}`;
    })
    .filter(Boolean);
  if (rows.length === 0) {
    return "";
  }
  return `Transcript Preview\n${rows.join("\n\n")}`;
}

function summaryFromPayload(
  title: string,
  summary: string | undefined,
  shortAbstractSummary: unknown,
  sourceUrl: string,
): string {
  const lines: string[] = [];
  if (title) {
    lines.push(title, "Transcript", "", `${sourceUrl.replace("view=transcript", "view=summary")}`);
  }

  if (typeof shortAbstractSummary === "string" && shortAbstractSummary.trim()) {
    lines.push("", shortAbstractSummary.trim());
  } else if (shortAbstractSummary && typeof shortAbstractSummary === "object") {
    const serialized = JSON.stringify(shortAbstractSummary, null, 2);
    lines.push("", serialized);
  } else if (summary && summary.trim()) {
    lines.push("", "Summary", summary.trim());
  }
  return lines.join("\n").trim();
}

export async function extractOtterSummaryAndTranscript(page: Page): Promise<{
  summary: string;
  transcript: string;
}> {
  await page.waitForLoadState("domcontentloaded");
  const currentUrl = page.url();

  const otidMatch = currentUrl.match(/\/u\/([^/?#]+)/i);
  const otid = otidMatch?.[1];
  if (!otid) {
    throw new Error("Could not parse Otter note id from URL");
  }

  const speechResponse = await page.request.get(`https://otter.ai/forward/api/v1/speech?otid=${otid}`);
  const speechPayload = (await speechResponse.json()) as OtterSpeechPayload;
  const speech = speechPayload.speech ?? {};
  const transcriptFromApi = formatTranscriptFromSpeech(speech.transcripts ?? []);
  const summaryFromClipboard = await readClipboardSummary(page);
  const summaryFromApi = summaryFromPayload(speech.title ?? "", speech.summary, speech.short_abstract_summary, currentUrl);
  let bodyText = "";
  try {
    bodyText = await page.locator("body").innerText();
  } catch {
    bodyText = "";
  }
  const fallbackLines = bodyText.split("\n").map((line) => normalizeWhitespace(line)).filter(Boolean);
  const fallbackTranscript = joinUnique(fallbackLines.filter((line) => /\d{1,2}:\d{2}/.test(line)));
  const fallbackSummary = joinUnique(
    fallbackLines.filter(
      (line) =>
        /^summary$/i.test(line) ||
        /^key points$/i.test(line) ||
        line.toLowerCase().startsWith("summary:") ||
        line.toLowerCase().startsWith("in this meeting"),
    ),
  );

  return {
    summary: summaryFromClipboard || summaryFromApi || fallbackSummary,
    transcript: transcriptFromApi || fallbackTranscript,
  };
}
