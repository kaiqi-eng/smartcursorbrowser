import type { Page } from "playwright";
import type { LoginFieldInput } from "../../types/job";

const SUBMIT_SELECTORS = [
  "button[type='submit']",
  "input[type='submit']",
  "button:has-text('Sign in')",
  "button:has-text('Sign In')",
  "button:has-text('Log in')",
  "button:has-text('Login')",
  "[role='button']:has-text('Sign in')",
  "[role='button']:has-text('Login')",
];

const LOGIN_ENTRY_SELECTORS = [
  "a:has-text('Login')",
  "a:has-text('Log in')",
  "a:has-text('Sign in')",
  "a:has-text('Sign In')",
  "text=Login",
  "text=Sign in",
  "text=Sign In",
];

function lower(value: string): string {
  return value.trim().toLowerCase();
}

function candidateSelectors(fieldName: string): string[] {
  const name = lower(fieldName);
  const isPassword = name.includes("pass");
  const isEmail = name.includes("email");
  const isUser = name.includes("user") || name.includes("login");

  if (isPassword) {
    return [
      "input[type='password']",
      "input[name*='pass' i]",
      "input[id*='pass' i]",
      "input[placeholder*='pass' i]",
    ];
  }
  if (isEmail) {
    return [
      "input[type='email']",
      "input[name*='email' i]",
      "input[id*='email' i]",
      "input[placeholder*='email' i]",
    ];
  }
  if (isUser) {
    return [
      "input[name*='user' i]",
      "input[id*='user' i]",
      "input[name*='login' i]",
      "input[id*='login' i]",
      "input[type='text']",
    ];
  }
  return [
    `input[name='${fieldName}']`,
    `input[id='${fieldName}']`,
    "input[type='text']",
  ];
}

async function fillIfFound(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }
      await locator.click({ timeout: 2500 });
      await locator.fill("", { timeout: 2500 });
      await locator.type(value, { delay: 35, timeout: 5000 });
      return true;
    } catch {
      // Try next selector.
    }
  }
  return false;
}

export async function isLikelyLoginPage(page: Page): Promise<boolean> {
  const hasPassword = (await page.locator("input[type='password']").count()) > 0;
  if (hasPassword) {
    return true;
  }
  const text = (await page.evaluate(() => document.body?.innerText?.slice(0, 1000) ?? "")).toLowerCase();
  return text.includes("sign in") || text.includes("log in") || text.includes("login") || text.includes("password");
}

/**
 * More permissive:
 * - if password field exists => not logged in
 * - if obvious auth prompt => not logged in
 * - otherwise assume logged in (like your original behavior)
 */
export async function isLikelyLoggedIn(page: Page): Promise<boolean> {
  const hasPassword = (await page.locator("input[type='password']").count()) > 0;
  if (hasPassword) {
    return false;
  }

  const text = (await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "")).toLowerCase();

  const authPrompts = ["sign in", "log in", "login", "continue with google", "continue with email"];

  if (authPrompts.some((s) => text.includes(s))) {
    return false;
  }

  return true;
}

export async function navigateToLoginEntry(page: Page): Promise<boolean> {
  // Site-specific fallback for Real Vision where auth lives on app subdomain.
  try {
    const url = new URL(page.url());
    if (url.hostname.endsWith("realvision.com") && !url.hostname.startsWith("app.")) {
      await page.goto("https://app.realvision.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
      return true;
    }
  } catch {
    // Continue generic selector-based navigation.
  }

  for (const selector of LOGIN_ENTRY_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }

      const currentUrl = page.url();
      const href = await locator.getAttribute("href");

      if (href && !href.startsWith("#") && !href.toLowerCase().startsWith("javascript:")) {
        const resolvedUrl = new URL(href, currentUrl).toString();
        await page.goto(resolvedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        return true;
      }

      await locator.click({ timeout: 3000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 });

      if (page.url() !== currentUrl) {
        return true;
      }

      if (href) {
        const resolvedUrl = new URL(href, currentUrl).toString();
        await page.goto(resolvedUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        return true;
      }
    } catch {
      // Try next selector
    }
  }

  return false;
}

export async function attemptDeterministicLogin(page: Page, loginFields: LoginFieldInput[]): Promise<boolean> {
  if (loginFields.length === 0) {
    return false;
  }

  let filled = 0;
  for (const field of loginFields) {
    const explicitSelectors = field.selector ? [field.selector] : [];
    const autoSelectors = candidateSelectors(field.name);
    const ok = await fillIfFound(page, [...explicitSelectors, ...autoSelectors], field.value);
    if (ok) {
      filled += 1;
    }
  }

  if (filled === 0) {
    return false;
  }

  for (const selector of SUBMIT_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }
      await locator.click({ timeout: 3000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      return true;
    } catch {
      // Try next submit control.
    }
  }

  // If no submit button, still try Enter first
  try {
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
    return true;
  } catch {
    // If no navigation happened, keep old permissive behavior
    return true;
  }
}