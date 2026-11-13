import { api, ApiError } from "./client";

vi.mock("aws-amplify/auth", () => ({ fetchAuthSession: vi.fn(async () => ({ tokens: undefined })) }));

describe("api on a bad connection (audit F16)", () => {
  const online = vi.spyOn(window.navigator, "onLine", "get");
  beforeEach(() => {
    online.mockReturnValue(true);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks a read again, after a pause, when the connection drops once", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const result = api<{ ok: boolean }>("/clinics");
    await vi.advanceTimersByTimeAsync(600);
    await expect(result).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("gives up on a read after two more tries, with status 0 and no unknown outcome", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    const result = api("/clinics").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(600 + 1800);
    const error = (await result) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.outcomeUnknown).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("never sends a write twice by itself, and says the outcome is unknown", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    const error = (await api("/appointments", { method: "POST", json: { startAt: "x" } }).catch((e: unknown) => e)) as ApiError;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(error.status).toBe(0);
    expect(error.outcomeUnknown).toBe(true);
  });

  it("does not claim an unknown outcome for a write made while the device was offline", async () => {
    online.mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = (await api("/appointments", { method: "POST", json: {} }).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.outcomeUnknown).toBe(false);
  });

  it("does not retry a read at all while the device is offline", async () => {
    online.mockReturnValue(false);
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    await api("/clinics").catch(() => undefined);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a read through a gateway error page, and survives a body that is not JSON", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ n: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const result = api<{ n: number }>("/clinics");
    await vi.advanceTimersByTimeAsync(600);
    await expect(result).resolves.toEqual({ n: 1 });
  });

  it("reports a gateway timeout on a write as an unknown outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>timeout</html>", { status: 504 })));
    const error = (await api("/appointments", { method: "POST", json: {} }).catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(504);
    expect(error.outcomeUnknown).toBe(true);
  });
});
