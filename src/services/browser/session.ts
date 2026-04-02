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
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    userAgent,
    acceptDownloads: false,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  return { browser, context, page };
}

export async function closeBrowserSession(session: BrowserSession): Promise<void> {
  await session.context.close();
  await session.browser.close();
}