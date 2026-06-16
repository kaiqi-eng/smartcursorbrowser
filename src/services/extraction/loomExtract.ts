import type { Page } from "playwright";

const LOOM_GRAPHQL_URL = "https://www.loom.com/graphql";

interface TranscriptSegment {
  startSeconds?: number;
  endSeconds?: number;
  text: string;
}

interface LoomMetadata {
  title: string;
  description: string;
  chapters: string;
}

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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value.trim()) {
      return value;
    }
  }
  return "";
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = asNumber(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function formatSeconds(secondsRaw: number): string {
  const seconds = Math.max(0, Math.round(secondsRaw));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = String(seconds % 60).padStart(2, "0");
  return `${minutesPart}:${secondsPart}`;
}

function parseTimestamp(value: string): number {
  const parts = value.split(":").map((part) => Number(part.replace(",", ".")));
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number.isFinite(parts[0]) ? parts[0] : 0;
}

export function parseLoomVideoId(url: string): string {
  try {
    const parsed = new URL(url);
    const shareMatch = parsed.pathname.match(/\/share\/([a-f0-9]{32})(?:[/?#]|$)?/i);
    if (shareMatch?.[1]) {
      return shareMatch[1];
    }
    const embedMatch = parsed.pathname.match(/\/embed\/([a-f0-9]{32})(?:[/?#]|$)?/i);
    if (embedMatch?.[1]) {
      return embedMatch[1];
    }
  } catch {
    // Fall through to a broad URL/string match.
  }

  const fallbackMatch = url.match(/[a-f0-9]{32}/i);
  if (!fallbackMatch?.[0]) {
    throw new Error("Could not parse Loom video id from URL");
  }
  return fallbackMatch[0];
}

function collectTranscriptSegments(value: unknown, segments: TranscriptSegment[] = []): TranscriptSegment[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTranscriptSegments(item, segments);
    }
    return segments;
  }

  const record = asRecord(value);
  if (!record) {
    return segments;
  }

  const text = normalizeWhitespace(
    firstString(record, ["text", "transcript", "sentence", "phrase", "caption", "value"]),
  );
  if (text) {
    segments.push({
      startSeconds: firstNumber(record, [
        "startSeconds",
        "start_seconds",
        "startSecond",
        "start",
        "start_time",
        "startTime",
        "offset",
      ]),
      endSeconds: firstNumber(record, [
        "endSeconds",
        "end_seconds",
        "endSecond",
        "end",
        "end_time",
        "endTime",
      ]),
      text,
    });
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      collectTranscriptSegments(nested, segments);
    }
  }

  return segments;
}

function formatTranscriptSegments(segments: TranscriptSegment[]): string {
  const rows = segments
    .map((segment) => {
      const text = normalizeWhitespace(segment.text);
      if (!text) {
        return "";
      }
      if (segment.startSeconds !== undefined) {
        return `${formatSeconds(segment.startSeconds)}\n${text}`;
      }
      return text;
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return "";
  }

  return `Transcript\n${joinUnique(rows)}`;
}

export function parseJsonTranscript(value: unknown): string {
  return formatTranscriptSegments(collectTranscriptSegments(value));
}

export function parseVttTranscript(value: string): string {
  const cues: TranscriptSegment[] = [];
  const blocks = value.replace(/\r/g, "").split(/\n\n+/);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const timestampIndex = lines.findIndex((line) => line.includes("-->"));
    if (timestampIndex < 0) {
      continue;
    }

    const [startRaw, endRaw] = lines[timestampIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const text = normalizeWhitespace(lines.slice(timestampIndex + 1).join(" "));
    if (!text) {
      continue;
    }

    cues.push({
      startSeconds: parseTimestamp(startRaw),
      endSeconds: parseTimestamp(endRaw),
      text,
    });
  }

  return formatTranscriptSegments(cues);
}

function formatChapters(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const chapters = collectChapterLines(parsed);
    if (chapters.length > 0) {
      return chapters.join("\n");
    }
  } catch {
    // Treat non-JSON chapter strings as already formatted text.
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function collectChapterLines(value: unknown, lines: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectChapterLines(item, lines);
    }
    return lines;
  }

  const record = asRecord(value);
  if (!record) {
    return lines;
  }

  const title = normalizeWhitespace(firstString(record, ["title", "text", "name", "summary"]));
  const seconds = firstNumber(record, ["time", "start", "startSeconds", "start_seconds", "offset"]);
  if (title) {
    lines.push(seconds === undefined ? title : `${formatSeconds(seconds)} ${title}`);
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      collectChapterLines(nested, lines);
    }
  }

  return lines;
}

export function buildLoomSummary(description: string, chapters: string): string {
  const blocks: string[] = [];
  const normalizedDescription = description.trim();
  const formattedChapters = formatChapters(chapters);

  if (normalizedDescription) {
    blocks.push(normalizedDescription);
  }

  if (formattedChapters) {
    blocks.push(`Chapters\n${formattedChapters}`);
  }

  return blocks.join("\n\n").trim();
}

async function postGraphql(page: Page, operationName: string, query: string, variables: Record<string, unknown>): Promise<unknown> {
  const response = await page.request.post(LOOM_GRAPHQL_URL, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "apollographql-client-name": "web",
      "x-loom-request-source": "loom_web",
    },
    data: {
      operationName,
      variables,
      query,
    },
  });

  if (!response.ok()) {
    throw new Error(`Loom GraphQL ${operationName} failed with status ${response.status()}`);
  }

  const payload = (await response.json()) as unknown;
  const record = asRecord(payload);
  const errors = record?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const firstError = asRecord(errors[0]);
    throw new Error(`Loom GraphQL ${operationName} error: ${asString(firstError?.message) || "unknown error"}`);
  }

  return payload;
}

function getGraphqlData(payload: unknown, key: string): Record<string, unknown> {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const node = asRecord(data?.[key]);
  if (!node) {
    return {};
  }

  const message = asString(node.message);
  if (message) {
    throw new Error(`Loom returned an error for ${key}: ${message}`);
  }

  return node;
}

async function fetchLoomMetadata(page: Page, videoId: string): Promise<LoomMetadata> {
  const payload = await postGraphql(
    page,
    "GetVideoSSR",
    `query GetVideoSSR($id: ID!, $password: String) {
      getVideo(id: $id, password: $password) {
        ... on RegularUserVideo {
          id
          name
          description
          chapters
        }
      }
    }`,
    { id: videoId, password: null },
  );
  const video = getGraphqlData(payload, "getVideo");

  return {
    title: asString(video.name),
    description: asString(video.description),
    chapters: asString(video.chapters),
  };
}

async function fetchTranscriptUrls(page: Page, videoId: string): Promise<{ sourceUrl: string; captionsSourceUrl: string }> {
  const payload = await postGraphql(
    page,
    "FetchVideoTranscript",
    `query FetchVideoTranscript($videoId: ID!, $password: String) {
      fetchVideoTranscript(videoId: $videoId, password: $password) {
        ... on VideoTranscriptDetails {
          source_url
          captions_source_url
        }
        ... on GenericError {
          message
        }
      }
    }`,
    { videoId, password: null },
  );
  const transcript = getGraphqlData(payload, "fetchVideoTranscript");

  return {
    sourceUrl: asString(transcript.source_url),
    captionsSourceUrl: asString(transcript.captions_source_url),
  };
}

async function fetchTranscriptFromUrl(page: Page, url: string, parser: (text: string) => string): Promise<string> {
  if (!url) {
    return "";
  }

  const response = await page.request.get(url);
  if (!response.ok()) {
    return "";
  }

  const text = await response.text();
  return parser(text);
}

async function fetchJsonTranscript(page: Page, url: string): Promise<string> {
  return fetchTranscriptFromUrl(page, url, (text) => {
    try {
      return parseJsonTranscript(JSON.parse(text) as unknown);
    } catch {
      return "";
    }
  });
}

async function fetchVttTranscript(page: Page, url: string): Promise<string> {
  return fetchTranscriptFromUrl(page, url, parseVttTranscript);
}

async function extractFromGraphql(page: Page, videoId: string): Promise<{ summary: string; transcript: string }> {
  const [metadata, transcriptUrls] = await Promise.all([
    fetchLoomMetadata(page, videoId).catch(() => ({ title: "", description: "", chapters: "" })),
    fetchTranscriptUrls(page, videoId).catch(() => ({ sourceUrl: "", captionsSourceUrl: "" })),
  ]);

  const transcript =
    (await fetchJsonTranscript(page, transcriptUrls.sourceUrl)) ||
    (await fetchVttTranscript(page, transcriptUrls.captionsSourceUrl));

  return {
    summary: buildLoomSummary(metadata.description, metadata.chapters),
    transcript,
  };
}

async function extractFromPage(page: Page): Promise<{ summary: string; transcript: string }> {
  let bodyText = "";
  let metaDescription = "";
  try {
    bodyText = await page.locator("body").innerText({ timeout: 5000 });
    metaDescription = await page
      .locator("meta[name='description']")
      .getAttribute("content", { timeout: 1000 })
      .then((value) => value ?? "")
      .catch(() => "");
  } catch {
    bodyText = "";
  }

  const lines = bodyText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const transcript = joinUnique(
    lines.filter((line) => /\d{1,2}:\d{2}/.test(line) && !/^chapter/i.test(line)),
  );
  const chapterLines = lines.filter(
    (line) => /^chapters?$/i.test(line) || /^chapter\s+\d+/i.test(line) || /^\d{1,2}:\d{2}\s+\S+/.test(line),
  );

  return {
    summary: buildLoomSummary(metaDescription, joinUnique(chapterLines)),
    transcript,
  };
}

export async function extractLoomSummaryAndTranscript(page: Page): Promise<{
  summary: string;
  transcript: string;
}> {
  await page.waitForLoadState("domcontentloaded");
  const videoId = parseLoomVideoId(page.url());

  const graphqlResult = await extractFromGraphql(page, videoId);
  if (graphqlResult.summary || graphqlResult.transcript) {
    return graphqlResult;
  }

  return extractFromPage(page);
}
