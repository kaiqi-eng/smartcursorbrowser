import type { BrowserAction } from "../../types/job";

export function shouldStop(action: BrowserAction, step: number, maxSteps: number, startedAtMs: number, timeoutMs: number): boolean {
  if (action.type === "done" || action.type === "extract") {
    return true;
  }
  if (step >= maxSteps) {
    return true;
  }
  return Date.now() - startedAtMs > timeoutMs;
}
