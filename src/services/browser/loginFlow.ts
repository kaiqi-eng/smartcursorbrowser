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
      await locator.fill(value, { timeout: 2500 });
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

export async function isLikelyLoggedIn(page: Page): Promise<boolean> {
  const hasPassword = (await page.locator("input[type='password']").count()) > 0;
  if (hasPassword) {
    return false;
  }

  const text = (await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? "")).toLowerCase();
  const hasAuthPrompt = text.includes("sign in") || text.includes("log in") || text.includes("login");
  const hasLoggedInCue =
    text.includes("sign out") ||
    text.includes("logout") ||
    text.includes("my account") ||
    text.includes("profile") ||
    text.includes("dashboard");

  if (hasLoggedInCue) {
    return true;
  }
  if (hasAuthPrompt) {
    return false;
  }
  return true;
}

export async function navigateToLoginEntry(page: Page): Promise<boolean> {
  for (const selector of LOGIN_ENTRY_SELECTORS) {
    try {
      const locator = page.locator(selector).first();
      if ((await locator.count()) === 0) {
        continue;
      }
      await locator.click({ timeout: 3000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 8000 });
      return true;
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

  // No submit control found/clicked; still report partial success because fields were filled.
  return true;
}
