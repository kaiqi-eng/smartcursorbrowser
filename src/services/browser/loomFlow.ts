import type { Page } from "playwright";
import type { LoginFieldInput } from "../../types/job";

const LOOM_LOGIN_URL = "https://www.loom.com/login";

const EMAIL_SELECTORS = [
  "input[name='email']",
  "input[type='email']",
  "input[placeholder*='email' i]",
  "input[aria-label*='email' i]",
  "input[id*='email' i]",
  "input[autocomplete='email']",
  "input[autocomplete='username']",
  "input[type='text'][name*='email' i]",
];

const PASSWORD_SELECTORS = [
  "input[type='password']",
  "input[name='password']",
  "input[placeholder*='password' i]",
  "input[aria-label*='password' i]",
  "input[id*='password' i]",
  "input[autocomplete='current-password']",
];

const SUBMIT_SELECTORS = [
  "button[type='submit']",
  "button:has-text('Continue')",
  "button:has-text('Log in')",
  "button:has-text('Login')",
  "button:has-text('Sign in')",
  "button:has-text('Sign In')",
  "[role='button']:has-text('Continue')",
  "[role='button']:has-text('Log in')",
  "[role='button']:has-text('Login')",
  "[role='button']:has-text('Sign in')",
  "[role='button']:has-text('Sign In')",
];

const COOKIE_BANNER_BUTTONS = [
  "button:has-text('Reject All')",
  "button:has-text('Reject all')",
  "button:has-text('Accept All Cookies')",
  "button:has-text('Accept all cookies')",
  "button:has-text('Accept All')",
  "button:has-text('Accept all')",
];

function getLoginValue(fields: LoginFieldInput[], key: "email" | "password"): string {
  const found = fields.find((field) => field.name.toLowerCase().includes(key));
  if (!found?.value) {
    throw new Error(`Missing required login field: ${key}`);
  }
  return found.value;
}

async function clickFirstInteractable(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      try {
        if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) {
          continue;
        }
        await candidate.click({ timeout: 2500 });
        return true;
      } catch {
        try {
          await candidate.click({ timeout: 2500, force: true });
          return true;
        } catch {
          // Try the next candidate.
        }
      }
    }
  }
  return false;
}

async function fillFirstInteractable(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      try {
        if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) {
          continue;
        }
        await candidate.fill(value, { timeout: 5000 });
        return true;
      } catch {
        // Try the next candidate.
      }
    }
  }
  return false;
}

async function hasVisibleInput(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      try {
        if (await locator.nth(index).isVisible()) {
          return true;
        }
      } catch {
        // Continue scanning candidates.
      }
    }
  }
  return false;
}

async function waitForAnyVisible(page: Page, selectors: string[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasVisibleInput(page, selectors)) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function dismissCookieBannerIfPresent(page: Page): Promise<void> {
  await clickFirstInteractable(page, COOKIE_BANNER_BUTTONS);
}

async function submitCurrentStep(page: Page): Promise<void> {
  await clickFirstInteractable(page, SUBMIT_SELECTORS);
  try {
    await page.keyboard.press("Enter");
  } catch {
    // Ignore enter-key errors if no active element.
  }
}

async function assertNoKnownLoginBlocker(page: Page): Promise<void> {
  const bodyText = (await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")).toLowerCase();
  const blockerMarkers = [
    "two-factor",
    "two factor",
    "2fa",
    "verification code",
    "verify your identity",
    "single sign-on",
    "sso",
    "captcha",
    "incorrect password",
    "invalid password",
    "invalid email",
  ];
  const marker = blockerMarkers.find((candidate) => bodyText.includes(candidate));
  if (marker) {
    throw new Error(`Loom login requires manual intervention or failed credentials (${marker})`);
  }
}

async function submitLoomEmailStep(page: Page): Promise<void> {
  await dismissCookieBannerIfPresent(page);
  const loomContinue = page.locator("button:has-text('Continue')").first();
  await loomContinue.click({ timeout: 10000 });
  await page.waitForURL(/atlassian\.com/i, { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function submitAtlassianLoginStep(page: Page, password: string): Promise<void> {
  const atlassianContinue = page.locator("button:has-text('Continue')").first();
  if ((await atlassianContinue.count()) > 0 && (await atlassianContinue.isVisible().catch(() => false))) {
    await atlassianContinue.click({ timeout: 10000 });
    await page.waitForTimeout(2000);
  }

  const passwordInput = page.locator("input[data-testid='password'], input#password, input[type='password']").first();
  await passwordInput.waitFor({ state: "visible", timeout: 15000 });
  await passwordInput.fill(password, { timeout: 10000 });

  const loginButton = page.locator("button:has-text('Log in'), button:has-text('Login')").first();
  await loginButton.click({ timeout: 10000 });
  await page.waitForURL(/loom\.com/i, { timeout: 60000 });
  await assertNoKnownLoginBlocker(page);
}

export async function performLoomLoginFlow(page: Page, url: string, loginFields: LoginFieldInput[]): Promise<void> {
  if (loginFields.length === 0) {
    throw new Error("Loom login requires credentials");
  }

  const email = getLoginValue(loginFields, "email");
  const password = getLoginValue(loginFields, "password");

  await page.goto(LOOM_LOGIN_URL, { waitUntil: "domcontentloaded" });
  await dismissCookieBannerIfPresent(page);

  const emailInput = page.locator("input[name='email'], input#email, input[type='email']").first();
  await emailInput.waitFor({ state: "visible", timeout: 15000 });
  await emailInput.fill(email, { timeout: 10000 });

  await submitLoomEmailStep(page);
  await submitAtlassianLoginStep(page, password);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
}
