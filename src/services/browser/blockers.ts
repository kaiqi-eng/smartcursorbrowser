import type { Page } from "playwright";

export type BlockerType =
  | "captcha"
  | "bot_challenge"
  | "access_denied"
  | "mfa_required"
  | "login_checkpoint";

export interface BlockerDetection {
  blocked: boolean;
  type?: BlockerType;
  reason?: string;
}

const TEXT_PATTERNS: Array<{ type: BlockerType; patterns: string[] }> = [
  {
    type: "captcha",
    patterns: [
      "captcha",
      "i'm not a robot",
      "i am not a robot",
      "verify you are human",
      "prove you are human",
      "security check",
    ],
  },
  {
    type: "bot_challenge",
    patterns: [
      "checking your browser before accessing",
      "attention required",
      "just a moment...",
      "cf-chl",
      "ddos protection by",
      "cloudflare",
    ],
  },
  {
    type: "access_denied",
    patterns: [
      "access denied",
      "forbidden",
      "request blocked",
      "temporarily blocked",
      "unusual traffic",
    ],
  },
  {
    type: "mfa_required",
    patterns: [
      "two-factor authentication",
      "2-step verification",
      "enter verification code",
      "check your authenticator app",
      "one-time password",
    ],
  },
  {
    type: "login_checkpoint",
    patterns: [
      "suspicious login attempt",
      "confirm it’s you",
      "confirm it's you",
      "verify your identity",
      "checkpoint",
    ],
  },
];

export async function detectBlocker(page: Page): Promise<BlockerDetection> {
  const url = page.url().toLowerCase();

  if (url.includes("captcha") || url.includes("challenge")) {
    return {
      blocked: true,
      type: "captcha",
      reason: `Challenge page detected by URL: ${url}`,
    };
  }

  const snapshot = await page.evaluate(() => {
    const bodyText = (document.body?.innerText ?? "").slice(0, 5000).toLowerCase();
    const html = document.documentElement?.outerHTML?.slice(0, 15000).toLowerCase() ?? "";
    return { bodyText, html };
  });

  for (const rule of TEXT_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (snapshot.bodyText.includes(pattern) || snapshot.html.includes(pattern)) {
        return {
          blocked: true,
          type: rule.type,
          reason: `Detected ${rule.type} pattern: "${pattern}"`,
        };
      }
    }
  }

  const selectors = [
    "iframe[title*='captcha' i]",
    "iframe[src*='recaptcha']",
    ".g-recaptcha",
    "#cf-challenge-running",
    "[data-sitekey]",
    "input[name='cf-turnstile-response']",
  ];

  for (const selector of selectors) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) {
        return {
          blocked: true,
          type: "captcha",
          reason: `Detected challenge widget via selector: ${selector}`,
        };
      }
    } catch {
      // ignore
    }
  }

  return { blocked: false };
}