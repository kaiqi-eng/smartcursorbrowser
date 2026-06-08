import type { Page } from "playwright";
import type { LoginFieldInput } from "../../types/job";

const EMAIL_SELECTORS = [
  "input[name='email']",
  "input[type='email']",
  "input[placeholder*='email' i]",
  "input[aria-label*='email' i]",
  "input[id*='email' i]",
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

const CREDENTIALS_MODE_BUTTONS = [
  "button:has-text('Other ways to log in')",
  "[role='button']:has-text('Other ways to log in')",
  "text=Other ways to log in",
];

const CONTINUE_BUTTONS = [
  "button:has-text('Sign In')",
  "button:has-text('Sign in')",
  "button:has-text('Next')",
  "[role='button']:has-text('Sign In')",
  "[role='button']:has-text('Sign in')",
  "[role='button']:has-text('Next')",
];

const EMAIL_SUBMIT_BUTTONS = [
  "button[type='submit']",
  "[role='button'][type='submit']",
  ...CONTINUE_BUTTONS,
];

const COOKIE_BANNER_BUTTONS = [
  "button:has-text('Reject All')",
  "button:has-text('Accept All Cookies')",
  "button:has-text('Accept All')",
  "button:has-text('Allow All')",
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
    if (count === 0) {
      continue;
    }
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      try {
        if (!(await candidate.isVisible())) {
          continue;
        }
      } catch {
        continue;
      }
      try {
        await candidate.click({ timeout: 2500 });
        return true;
      } catch {
        try {
          await candidate.click({ timeout: 2500, force: true });
          return true;
        } catch {
          // Try next selector candidate.
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
    if (count === 0) {
      continue;
    }
    for (let i = 0; i < count; i += 1) {
      const candidate = locator.nth(i);
      try {
        if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) {
          continue;
        }
      } catch {
        continue;
      }
      try {
        await candidate.fill(value, { timeout: 5000 });
        return true;
      } catch {
        // Try next selector candidate.
      }
    }
  }
  return false;
}

async function hasVisibleInput(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      try {
        if (await locator.nth(i).isVisible()) {
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
    await page.waitForTimeout(200);
  }
  return false;
}

async function dismissCookieBannerIfPresent(page: Page): Promise<void> {
  await clickFirstInteractable(page, COOKIE_BANNER_BUTTONS);
}

async function ensureCredentialsMode(page: Page): Promise<void> {
  if (await waitForAnyVisible(page, EMAIL_SELECTORS, 1500)) {
    return;
  }
  await clickFirstInteractable(page, CREDENTIALS_MODE_BUTTONS);
  const hasEmail = await waitForAnyVisible(page, EMAIL_SELECTORS, 7000);
  if (!hasEmail) {
    throw new Error("Unable to reveal Otter email login form");
  }
}

async function submitAndAwaitPasswordStep(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (page.url().includes("/password") || (await waitForAnyVisible(page, PASSWORD_SELECTORS, 1200))) {
      return;
    }

    await dismissCookieBannerIfPresent(page);

    const emailInput = page
      .locator(
        "input[name='email'], input[type='email'], input[placeholder*='email' i], input[aria-label*='email' i], input[id*='email' i]",
      )
      .first();

    try {
      if ((await emailInput.count()) > 0) {
        await emailInput.click({ timeout: 1200 });
        await emailInput.press("Enter", { timeout: 1200 });
      }
    } catch {
      // Keep trying alternative submit actions.
    }

    await clickFirstInteractable(page, EMAIL_SUBMIT_BUTTONS);
    try {
      await page.keyboard.press("Enter");
    } catch {
      // Ignore enter-key errors if no active element.
    }

    try {
      await page.waitForURL(/\/password(?:[/?#]|$)/i, { timeout: 1500 });
      return;
    } catch {
      // URL didn't change; continue with DOM checks.
    }

    if (page.url().includes("/password") || (await waitForAnyVisible(page, PASSWORD_SELECTORS, 2200))) {
      return;
    }
  }

  throw new Error("Otter email submit did not progress to password step");
}

async function submitPassword(page: Page): Promise<void> {
  await clickFirstInteractable(page, CONTINUE_BUTTONS);
  try {
    await page.keyboard.press("Enter");
  } catch {
    // Ignore enter-key errors if no active element.
  }
}

async function assertAuthenticatedProfile(page: Page, email: string): Promise<void> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const profileResponse = await page.request.get("https://otter.ai/forward/api/v1/user/profile");
    lastStatus = profileResponse.status();
    if (lastStatus !== 200) {
      await page.waitForTimeout(800);
      continue;
    }

    const profileData = (await profileResponse.json()) as { email?: string; user?: { email?: string } };
    const loggedInEmail = (profileData.email ?? profileData.user?.email ?? "").trim();
    if (!loggedInEmail) {
      await page.waitForTimeout(800);
      continue;
    }

    if (loggedInEmail.toLowerCase() !== email.toLowerCase()) {
      throw new Error("Otter login completed but authenticated user does not match provided email");
    }
    return;
  }

  throw new Error(`Otter login did not establish authenticated session (profile status: ${lastStatus})`);
}

async function performPopupLogin(loginPage: Page, email: string, password: string): Promise<void> {
  await loginPage.waitForLoadState("domcontentloaded");
  if (!loginPage.url().includes("/signin")) {
    await loginPage.goto("https://otter.ai/signin", { waitUntil: "domcontentloaded" });
  }

  await dismissCookieBannerIfPresent(loginPage);
  await ensureCredentialsMode(loginPage);

  const emailFilled = await fillFirstInteractable(loginPage, EMAIL_SELECTORS, email);
  if (!emailFilled) {
    throw new Error("Unable to locate Otter email input");
  }

  await submitAndAwaitPasswordStep(loginPage);

  const passwordFilled = await fillFirstInteractable(loginPage, PASSWORD_SELECTORS, password);
  if (!passwordFilled) {
    throw new Error("Unable to locate Otter password input");
  }

  await submitPassword(loginPage);
  await assertAuthenticatedProfile(loginPage, email);
}

export async function performOtterLoginFlow(page: Page, url: string, loginFields: LoginFieldInput[]): Promise<void> {
  if (loginFields.length === 0) {
    throw new Error("Otter login requires credentials");
  }
  const email = getLoginValue(loginFields, "email");
  const password = getLoginValue(loginFields, "password");

  await page.goto("https://otter.ai/signin", { waitUntil: "domcontentloaded" });
  await performPopupLogin(page, email, password);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
}
