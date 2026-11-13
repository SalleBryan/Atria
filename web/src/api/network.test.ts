import { act, renderHook } from "@testing-library/react";

import { ApiError } from "./client";
import { describeFailure, failureKind, isTransient } from "./failure";
import { connectionNow, reportReachable, startPolling, useConnection } from "./network";

vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn(async () => ({ tokens: undefined })) }));

const online = vi.spyOn(window.navigator, "onLine", "get");
const visibility = vi.spyOn(document, "visibilityState", "get");

beforeEach(() => {
  online.mockReturnValue(true);
  visibility.mockReturnValue("visible");
  reportReachable(true);
});

describe("describeFailure", () => {
  it("sorts failures into offline, server, conflict, refused and other", () => {
    expect(failureKind(new ApiError(0, "x"))).toBe("offline");
    expect(failureKind(new ApiError(503, "x"))).toBe("server");
    expect(failureKind(new ApiError(409, "x"))).toBe("conflict");
    expect(failureKind(new ApiError(403, "x"))).toBe("refused");
    expect(failureKind(new ApiError(400, "x"))).toBe("other");
    expect(failureKind(new Error("x"))).toBe("other");
    expect(isTransient(new ApiError(0, "x"))).toBe(true);
    expect(isTransient(new ApiError(409, "x"))).toBe(false);
  });

  it("says a write that left the device may have gone through, and one that did not leave says nothing was sent", () => {
    const unknown = describeFailure(new ApiError(0, "x", undefined, true), { write: true });
    expect(unknown.outcomeUnknown).toBe(true);
    expect(unknown.text).toContain("cannot tell whether it went through");
    const unsent = describeFailure(new ApiError(0, "x"), { write: true });
    expect(unsent.outcomeUnknown).toBe(false);
    expect(unsent.text).toBe("You are offline, so nothing was sent.");
  });

  it("speaks of a failed read without mentioning sending", () => {
    expect(describeFailure(new ApiError(0, "x")).text).toBe("We could not reach Atria. Check your connection.");
  });

  it("keeps the server's own words for a conflict or a refusal, ending in a full stop", () => {
    expect(describeFailure(new ApiError(409, "That slot is taken")).text).toBe("That slot is taken.");
  });
});

describe("connection", () => {
  it("is offline when the device says so, unreachable when Atria did not answer, online otherwise", () => {
    expect(connectionNow()).toBe("online");
    reportReachable(false);
    expect(connectionNow()).toBe("unreachable");
    online.mockReturnValue(false);
    expect(connectionNow()).toBe("offline");
  });

  it("follows the browser's online and offline events", () => {
    const { result } = renderHook(() => useConnection());
    expect(result.current).toBe("online");
    act(() => {
      online.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe("offline");
    act(() => {
      online.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe("online");
  });
});

describe("startPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reads on its interval", async () => {
    const read = vi.fn().mockResolvedValue(undefined);
    const stop = startPolling(read, 30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });

  it("pauses while the device is offline and reads at once when it comes back", async () => {
    const read = vi.fn().mockResolvedValue(undefined);
    const stop = startPolling(read, 30_000, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);

    online.mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(read).toHaveBeenCalledTimes(1);

    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    stop();
  });

  it("pauses in a hidden tab and reads at once when it is shown", async () => {
    const read = vi.fn().mockResolvedValue(undefined);
    const stop = startPolling(read, 30_000);
    visibility.mockReturnValue("hidden");
    await vi.advanceTimersByTimeAsync(5 * 30_000);
    expect(read).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    stop();
  });

  it("waits twice as long after each failure and recovers its pace on success", async () => {
    const read = vi.fn().mockRejectedValue(new Error("down"));
    const stop = startPolling(read, 10_000, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(1); // the next wait is 20 s, not 10
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(2);
    read.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(40_000); // two failures: the next wait is 40 s
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000); // back to the normal pace
    expect(read).toHaveBeenCalledTimes(4);
    stop();
  });

  it("stops for good when told to", async () => {
    const read = vi.fn().mockResolvedValue(undefined);
    const stop = startPolling(read, 1000);
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).not.toHaveBeenCalled();
  });
});
