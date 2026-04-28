import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../src/utils/timeout";

describe("withTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the wrapped promise value before the timeout", async () => {
    vi.useFakeTimers();

    const resultPromise = withTimeout(
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("completed"), 25);
      }),
      100,
      "fast operation",
    );

    await vi.advanceTimersByTimeAsync(25);

    await expect(resultPromise).resolves.toBe("completed");
  });

  it("rejects with an OperationTimeoutError when the wrapped promise does not settle", async () => {
    vi.useFakeTimers();

    const resultPromise = withTimeout(new Promise<string>(() => undefined), 100, "slow operation");
    const rejectionAssertion = expect(resultPromise).rejects.toMatchObject({
      name: "OperationTimeoutError",
      message: "slow operation timed out after 100ms",
    });

    await vi.advanceTimersByTimeAsync(100);

    await rejectionAssertion;
  });

  it("does not install a timeout when timeoutMs is zero or negative", async () => {
    vi.useFakeTimers();

    const zeroTimeoutPromise = withTimeout(Promise.resolve("zero"), 0, "zero timeout");
    const negativeTimeoutPromise = withTimeout(Promise.resolve("negative"), -1, "negative timeout");

    await expect(zeroTimeoutPromise).resolves.toBe("zero");
    await expect(negativeTimeoutPromise).resolves.toBe("negative");
  });
});
