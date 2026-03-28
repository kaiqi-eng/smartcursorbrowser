import type { Page } from "playwright";
import type { BrowserAction, LoginFieldInput } from "../../types/job";

const MAX_WAIT_MS = 10000;
const MAX_SCROLL_BY = 4000;

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
      if (!action.selector) {
        throw new Error("Action 'click' requires a selector");
      }
      const selector = normalizeSelector(action.selector);
      await page.click(selector);
      return;
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
