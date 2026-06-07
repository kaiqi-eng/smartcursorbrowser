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
            // Try next selector candidate.
          }
        }
      }
    }
  }
  return false;
}

async function hasVisiblePasswordInput(page: Page): Promise<boolean> {
  const locators = [
    page.locator("input[type='password']"),
    page.locator("input[placeholder*='password' i]"),
    page.locator("input[aria-label*='password' i]"),
    page.locator("input[name*='password' i]"),
    page.locator("input[id*='password' i]"),
  ];

  for (const locator of locators) {
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

async function fillIfVisible(page: Page, selectors: string[], value: string): Promise<boolean> {
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
        await candidate.fill(value, { timeout: 5000 });
        return true;
      } catch {
        // Try next selector candidate.
      }
    }
  }
  return false;
}

async function waitForPasswordStep(loginPage: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await hasVisiblePasswordInput(loginPage)) {
      return;
    }
    await clickIfVisible(loginPage, [
      "button:has-text('Sign in')",
      "button:has-text('Sign In')",
      "button:has-text('Next')",
      "[role='button']:has-text('Sign in')",
      "[role='button']:has-text('Sign In')",
      "[role='button']:has-text('Next')",
    ]);
    try {
      await loginPage.keyboard.press("Enter");
    } catch {
      // Some views may not focus an input; keep retrying.
    }
    await loginPage.waitForTimeout(1000);
  }
}

async function performPopupLogin(loginPage: Page, email: string, password: string): Promise<void> {
  await loginPage.waitForLoadState("domcontentloaded");
  if (!loginPage.url().includes("/signin")) {
    await loginPage.goto("https://otter.ai/signin", { waitUntil: "domcontentloaded" });
  }
  let emailFilled = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await clickIfVisible(loginPage, [
      "button:has-text('Other ways to log in')",
      "[role='button']:has-text('Other ways to log in')",
      "text=Other ways to log in",
    ]);
    await clickIfVisible(loginPage, [
      "button:has-text('Reject All')",
      "button:has-text('Accept All Cookies')",
      "button:has-text('Accept All')",
    ]);
    await loginPage.waitForTimeout(900);

    emailFilled = await fillIfVisible(
      loginPage,
      [
        "input[placeholder*='email' i]",
        "input[type='email']",
        "input[type='text']",
        "input[aria-label*='email' i]",
        "input[name*='email' i]",
        "input[id*='email' i]",
      ],
      email,
    );
    if (emailFilled) {
      break;
    }
  }
  if (!emailFilled) {
    throw new Error("Unable to locate Otter email input");
  }

  await waitForPasswordStep(loginPage);

  const passwordFilled = await fillIfVisible(
    loginPage,
    [
      "input[type='password']",
      "input[placeholder*='password' i]",
      "input[aria-label*='password' i]",
      "input[name*='password' i]",
      "input[id*='password' i]",
    ],
    password,
  );
  if (!passwordFilled) {
    throw new Error("Unable to locate Otter password input");
  }

  await clickIfVisible(loginPage, [
    "button:has-text('Next')",
    "button:has-text('Sign in')",
    "button:has-text('Sign In')",
    "[role='button']:has-text('Next')",
  ]);
  await loginPage.waitForTimeout(2200);

  const profileResponse = await loginPage.request.get("https://otter.ai/forward/api/v1/user/profile");
  if (profileResponse.status() !== 200) {
    throw new Error("Otter login did not establish authenticated session");
  }
  const profileData = (await profileResponse.json()) as { email?: string; user?: { email?: string } };
  const loggedInEmail = profileData.email ?? profileData.user?.email ?? "";
  if (loggedInEmail.toLowerCase() !== email.toLowerCase()) {
    throw new Error("Otter login completed but authenticated user does not match provided email");
  }
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
