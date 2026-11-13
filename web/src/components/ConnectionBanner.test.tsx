import { act, fireEvent, render, screen } from "@testing-library/react";

import { reportReachable } from "../api/network";
import { ConnectionBanner } from "./ConnectionBanner";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", () => ({ api }));

const online = vi.spyOn(window.navigator, "onLine", "get");

beforeEach(() => {
  api.mockReset();
  online.mockReturnValue(true);
  reportReachable(true);
});

function go(isOnline: boolean) {
  act(() => {
    online.mockReturnValue(isOnline);
    window.dispatchEvent(new Event(isOnline ? "online" : "offline"));
  });
}

describe("ConnectionBanner", () => {
  it("shows nothing while online", () => {
    render(<ConnectionBanner />);
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });

  it("says so in plain words when the device goes offline, announced politely", () => {
    render(<ConnectionBanner />);
    go(false);
    const words = screen.getByText(/You are offline\./);
    const banner = words.closest(".notice");
    expect(banner?.getAttribute("role")).toBe("status");
    expect(banner?.textContent).toContain("may be out of date");
    expect(banner?.textContent).toContain("Nothing you do is sent until the connection is back.");
  });

  it("says Atria cannot be reached when the network is there but the answer is not", () => {
    render(<ConnectionBanner />);
    act(() => reportReachable(false));
    expect(screen.getByText(/Atria cannot be reached right now/)).toBeTruthy();
  });

  it("goes away and says back online when the connection returns", () => {
    render(<ConnectionBanner />);
    go(false);
    go(true);
    expect(screen.queryByText(/You are offline/)).toBeNull();
    expect(screen.getByText(/Back online/)).toBeTruthy();
  });

  it("lets the person ask for a real check", async () => {
    api.mockRejectedValue(new Error("down"));
    render(<ConnectionBanner />);
    go(false);
    fireEvent.click(screen.getByRole("button", { name: "Try now" }));
    expect(api).toHaveBeenCalledWith("/me");
    await screen.findByRole("button", { name: "Try now" });
  });
});
