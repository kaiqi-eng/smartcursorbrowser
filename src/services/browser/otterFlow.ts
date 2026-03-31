import type { Page } from "playwright";
import type { LoginFieldInput } from "../../types/job";

function getLoginValue(fields: LoginFieldInput[], key: "email" | "password"): string {
  const found = fields.find((field) => field.name.toLowerCase().includes(key));
  if (!found?.value) {
    throw new Error(`Missing required login field: ${key}`);
  }
  return found.value;
}

async function clickIfVisible(page: Page, selectors: string[]): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }
    try {
      await locator.click({ timeout: 2500 });
      return true;
    } catch {
      try {
        await locator.click({ timeout: 2500, force: true });
        return true;
      } catch {
        try {
          const domClicked = await page.evaluate((value) => {
            const element = document.querySelector<HTMLElement>(value);
            if (!element) {
              return false;
            }
            element.click();
            return true;
          }, selector);
          if (domClicked) {
            return true;
          }
        } catch {
          // Try next selector.
        }
      }
    }
  }
  return false;
}

async function fillIfVisible(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }
    try {
      await locator.fill(value, { timeout: 5000 });
      return true;
    } catch {
      // Try next selector.
    }
  }
  return false;
}

async function performPopupLogin(loginPage: Page, email: string, password: string): Promise<void> {
  await loginPage.waitForLoadState("domcontentloaded");
  if (!loginPage.url().includes("/signin")) {
    await loginPage.goto("https://otter.ai/signin", { waitUntil: "domcontentloaded" });
  }
  let emailFilled = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await clickIfVisible(loginPage, [
        "button:has-text('Other ways to log in')",
        "[role='button']:has-text('Other ways to log in')",
        "text=Other ways to log in",
      ]);
      await loginPage.waitForTimeout(1000);
    }
    emailFilled = await fillIfVisible(
      loginPage,
      [
        "input[type='email']",
        "input[placeholder*='email' i]",
        "input[aria-label*='email' i]",
        "input[name*='email' i]",
        "input[id*='email' i]",
        "[role='textbox'][aria-label*='email' i]",
        "input[type='text']",
      ],
      email,
    );
    if (emailFilled) {
      break;
    }
  }
  if (!emailFilled) {
    const preview = await loginPage.evaluate(() => document.body?.innerText?.slice(0, 600) ?? "").catch(() => "");
    throw new Error(`Unable to locate Otter email input on ${loginPage.url()} :: ${preview}`);
  }

  let passwordFilled = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickIfVisible(loginPage, [
      "button:has-text('Sign in')",
      "[role='button']:has-text('Sign in')",
      "button:has-text('Next')",
      "[role='button']:has-text('Next')",
    ]);
    await loginPage.waitForTimeout(900);

    passwordFilled = await fillIfVisible(
      loginPage,
      [
        "input[type='password']",
        "input[placeholder*='password' i]",
        "input[aria-label*='password' i]",
        "input[name*='password' i]",
        "input[id*='password' i]",
        "[role='textbox'][aria-label*='password' i]",
      ],
      password,
    );
    if (passwordFilled) {
      break;
    }
  }
  if (!passwordFilled) {
    throw new Error("Unable to locate Otter password input");
  }

  await clickIfVisible(loginPage, [
    "button:has-text('Next')",
    "button:has-text('Sign in')",
    "[role='button']:has-text('Next')",
  ]);
  await loginPage.waitForLoadState("domcontentloaded");
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
}
