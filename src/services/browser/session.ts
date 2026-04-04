import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { env } from "../../config/env";

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function createBrowserSession(userAgent?: string): Promise<BrowserSession> {
  const browser = await chromium.launch({
    headless: env.browserHeadless,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-extensions",
      "--disable-sync",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,BackForwardCache,AcceptCHFrame",
    ],
  });

  const context = await browser.newContext({
    userAgent,
    acceptDownloads: false,
  });

  // New: block heavy resources to reduce RAM/CPU/network
  if (env.blockHeavyResources) {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const type = request.resourceType();
      const url = request.url().toLowerCase();

      if (["image", "font", "media"].includes(type)) {
        return route.abort();
      }

      if (
        url.includes("doubleclick") ||
        url.includes("googletagmanager") ||
        url.includes("google-analytics") ||
        url.includes("facebook.net") ||
        url.includes("hotjar")
      ) {
        return route.abort();
      }

      return route.continue();
    });
  }

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  return { browser, context, page };
}

export async function closeBrowserSession(session: BrowserSession): Promise<void> {
  await session.context.close();
  await session.browser.close();
}