import { Buffer } from "buffer";
import * as cheerio from "cheerio";
import { env } from "../../config/env";

function timeoutSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

// =====================
// ARTICLE EXTRACTOR
// =====================
function extractArticle(html: string, url: string) {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg").remove();

  const title =
    $("meta[property='og:title']").attr("content") ||
    $("h1").first().text() ||
    $("title").text() ||
    null;

  const publishDate =
    $("meta[property='article:published_time']").attr("content") ||
    $("time").attr("datetime") ||
    $("time").text() ||
    null;

  const thumbnail =
    $("meta[property='og:image']").attr("content") || null;

  const paragraphs: string[] = [];

  $("article p, main p, p").each((_, el) => {
    const text = $(el).text().trim();

    if (text.length > 40 && !text.includes("{") && !text.includes("rgb(")) {
      paragraphs.push(text);
    }
  });

  return {
    title: title?.trim(),
    source: url,
    publishDate,
    thumbnail,
    content: paragraphs.join(" "),
  };
}

// =====================
// LINK EXTRACTOR
// =====================
function extractArticleLinks(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a").each((_, el) => {
    let href = $(el).attr("href");
    if (!href) return;

    if (!href.startsWith("http")) {
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        return;
      }
    }

    if (
      href.includes("#") ||
      href.includes("login") ||
      href.includes("signup") ||
      href.includes("video") ||
      href.length < 30
    ) {
      return;
    }

    links.add(href);
  });

  return Array.from(links).slice(0, 10);
}

// =====================
// OXYLABS FETCH
// =====================
async function fetchWithOxylabs(url: string): Promise<string> {
  if (!env.oxylabsUsername || !env.oxylabsPassword) {
    throw new Error(
      "Oxylabs credentials not configured (OXYLABS_USERNAME / OXYLABS_PASSWORD missing)"
    );
  }

  const authHeader =
    "Basic " +
    Buffer.from(`${env.oxylabsUsername}:${env.oxylabsPassword}`).toString(
      "base64"
    );

  const res = await fetch("https://data.oxylabs.io/v1/queries", {
    method: "POST",
    body: JSON.stringify({ source: "universal", url }),
    signal: timeoutSignal(env.oxylabsRequestTimeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
  });

  const json: any = await res.json();

  if (!json?.id) {
    throw new Error("Oxylabs job submission failed — no job ID returned");
  }

  const resultUrl = `https://data.oxylabs.io/v1/queries/${json.id}/results`;

  const MAX_POLL_ATTEMPTS = 20;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const pollRes = await fetch(resultUrl, {
      signal: timeoutSignal(env.oxylabsRequestTimeoutMs),
      headers: { Authorization: authHeader },
    });

    const text = await pollRes.text();

    if (text && text.trim().length > 0) {
      try {
        const parsed: any = JSON.parse(text);

        if (parsed?.results?.length > 0) {
          return parsed.results[0].content;
        }
      } catch {
        // still processing
      }
    }

    console.log(
      `⏳ Waiting for Oxylabs result (${attempt + 1}/${MAX_POLL_ATTEMPTS})`
    );

    await new Promise((r) => setTimeout(r, 3000));
  }

  throw new Error("Oxylabs polling timed out");
}

// =====================
// MAIN FALLBACK
// =====================
export async function runOxylabsFallback(inputUrl: string) {
  console.log("🚨 Oxylabs fallback started for:", inputUrl);

  try {
    const html = await fetchWithOxylabs(inputUrl);

    const links = extractArticleLinks(html, inputUrl);
    console.log(`🔗 Found ${links.length} links`);

    const landingArticle = extractArticle(html, inputUrl);

    const subResults = await Promise.all(
      links.map(async (link) => {
        try {
          const res = await fetch(link, {
            signal: timeoutSignal(env.oxylabsArticleFetchTimeoutMs),
          });
          const subHtml = await res.text();
          const article = extractArticle(subHtml, link);

          if (article.content?.length > 100) {
            return article;
          }
        } catch {
          // ignore failures
        }

        return null;
      })
    );

    const results = [
      ...(landingArticle.content?.length > 100 ? [landingArticle] : []),
      ...subResults.filter(Boolean),
    ];

    console.log(`✅ Returned ${results.length} articles`);

    return results;
  } catch (err: any) {
    console.log("❌ Oxylabs fallback failed:", err?.message || err);
    return [];
  }
}