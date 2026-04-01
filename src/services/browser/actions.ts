import type { Page } from "playwright";
import type { BrowserAction, LoginFieldInput } from "../../types/job";

const MAX_WAIT_MS = 10000;
const MAX_SCROLL_BY = 4000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

async function clampClickCoordinates(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const viewport = page.viewportSize();
  if (viewport) {
    return {
      x: clamp(Math.round(x), 0, Math.max(0, viewport.width - 1)),
      y: clamp(Math.round(y), 0, Math.max(0, viewport.height - 1)),
    };
  }

  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  }));

  return {
    x: clamp(Math.round(x), 0, Math.max(0, dimensions.width - 1)),
    y: clamp(Math.round(y), 0, Math.max(0, dimensions.height - 1)),
  };
}

function normalizeSelector(selector: string): string {
  // Convert jQuery-style selectors to Playwright-friendly text selectors.
  return selector
    .replace(/:contains\("([^"]+)"\)/g, ':has-text("$1")')
    .replace(/:contains\('([^']+)'\)/g, ':has-text("$1")');
}

function resolveLoginValue(action: BrowserAction, loginFields: LoginFieldInput[] = []): string | undefined {
  if (!action.text) {
    return undefined;
  }
  if (!action.text.startsWith("{{") || !action.text.endsWith("}}")) {
    return action.text;
  }
  const key = action.text.slice(2, -2).trim().toLowerCase();
  const matched = loginFields.find((field) => field.name.toLowerCase() === key);
  return matched?.value;
}

function isLoginishSelector(selector: string): boolean {
  const value = selector.toLowerCase();
  return value.includes("login") || value.includes("log in") || value.includes("sign in") || value.includes("signin");
}

async function clickWithLoginFallback(page: Page, selector: string): Promise<void> {
  try {
    await page.click(selector);
    return;
  } catch (error) {
    if (!isLoginishSelector(selector)) {
      throw error;
    }
  }

  const fallbacks = [
    "a:has-text('Login')",
    "a:has-text('Log in')",
    "a:has-text('Sign in')",
    "a:has-text('Sign In')",
    "text=Login",
    "text=Sign in",
    "text=Sign In",
  ];

  for (const fallback of fallbacks) {
    const locator = page.locator(fallback).first();
    if ((await locator.count()) === 0) {
      continue;
    }
    try {
      await locator.click({ timeout: 3000 });
      return;
    } catch {
      // try next fallback selector
    }
  }

  throw new Error(`Failed login-ish click using selector '${selector}' and all fallback selectors`);
}

export async function executeBrowserAction(
  page: Page,
  action: BrowserAction,
  loginFields: LoginFieldInput[] = [],
): Promise<void> {
  switch (action.type) {
    case "goto": {
      if (!action.url) {
        throw new Error("Action 'goto' requires a url");
      }
      await page.goto(action.url, { waitUntil: "domcontentloaded" });
      return;
    }
    case "click": {
      const hasCoordinates = Number.isFinite(action.x) && Number.isFinite(action.y);
      if (hasCoordinates) {
        const coords = await clampClickCoordinates(page, action.x as number, action.y as number);
        await page.mouse.click(coords.x, coords.y);
        return;
      }
      if (action.selector) {
        const selector = normalizeSelector(action.selector);
        await clickWithLoginFallback(page, selector);
        return;
      }
      throw new Error("Action 'click' requires coordinates (x and y) or a selector");
    }
    case "type": {
      if (!action.selector) {
        throw new Error("Action 'type' requires a selector");
      }
      const selector = normalizeSelector(action.selector);
      const value = resolveLoginValue(action, loginFields);
      if (value === undefined) {
        throw new Error("Action 'type' requires text or credential token");
      }
      await page.fill(selector, value);
      return;
    }
    case "wait": {
      const waitMs = Math.min(Math.max(100, action.waitMs ?? 1000), MAX_WAIT_MS);
      await page.waitForTimeout(waitMs);
      return;
    }
    case "scroll": {
      const scrollBy = Math.min(Math.max(-MAX_SCROLL_BY, action.scrollBy ?? 800), MAX_SCROLL_BY);
      await page.mouse.wheel(0, scrollBy);
      await page.waitForTimeout(250);
      return;
    }
    case "extract":
    case "done": {
      return;
    }
    default:
      throw new Error(`Unsupported action type: ${(action as BrowserAction).type}`);
  }
}
