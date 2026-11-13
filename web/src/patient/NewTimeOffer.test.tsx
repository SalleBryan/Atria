import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "../api/client";
import { type Appointment } from "./data";
import { NewTimeOffer } from "./NewTimeOffer";

const api = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({ ...(await original<typeof import("../api/client")>()), api }));
vi.mock("./data", async (original) => ({
  ...(await original<typeof import("./data")>()),
  usePatientData: () => ({ state: { status: "loading" }, reload }),
}));

const APPOINTMENT = {
  appointmentId: "a-1",
  clinicianProfileId: "s-1",
  appointmentTypeId: "at-1",
  startAt: "2026-11-14T08:00:00Z",
} as unknown as Appointment;

const SLOTS = {
  days: {
    "2026-11-15": [
      { startAt: "2026-11-15T09:00:00Z", endAt: "2026-11-15T09:30:00Z" },
      { startAt: "2026-11-15T10:00:00Z", endAt: "2026-11-15T10:30:00Z" },
    ],
  },
};

function mount(move: () => unknown) {
  api.mockImplementation(async (path: string) => {
    if (path.includes("/slots")) return SLOTS;
    if (path.endsWith("/reschedule")) return move();
    throw new Error(`unexpected ${path}`);
  });
  return render(<NewTimeOffer appointment={APPOINTMENT} onMoved={vi.fn()} onMore={vi.fn()} />);
}

describe("NewTimeOffer when a move fails (audit F16)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says a time was taken only for a conflict, and removes that time", async () => {
    mount(() => {
      throw new ApiError(409, "slot taken");
    });
    const offers = await screen.findAllByRole("button", { name: /\d\d:\d\d/ });
    await userEvent.click(offers[0]!);
    expect(await screen.findByText("That time was just taken. Choose another.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /\d\d:\d\d/ })).toHaveLength(1);
  });

  it("keeps every offered time when the connection fails before sending, and says nothing moved", async () => {
    mount(() => {
      throw new ApiError(0, "down");
    });
    await userEvent.click((await screen.findAllByRole("button", { name: /\d\d:\d\d/ }))[0]!);
    expect(await screen.findByText(/You are offline, so nothing was sent/)).toBeInTheDocument();
    expect(screen.queryByText(/just taken/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /\d\d:\d\d/ })).toHaveLength(2);
  });

  it("says the outcome is unknown after a drop mid-request, keeps the times, and offers to check the visit", async () => {
    mount(() => {
      throw new ApiError(0, "down", undefined, true);
    });
    await userEvent.click((await screen.findAllByRole("button", { name: /\d\d:\d\d/ }))[0]!);
    expect(await screen.findByText(/cannot tell whether it went through/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /\d\d:\d\d/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Check my visit" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
  });

  it("does not move the visit a second time by itself", async () => {
    mount(() => {
      throw new ApiError(0, "down", undefined, true);
    });
    await userEvent.click((await screen.findAllByRole("button", { name: /\d\d:\d\d/ }))[0]!);
    await screen.findByText(/cannot tell/);
    expect(api.mock.calls.filter(([path]) => String(path).endsWith("/reschedule"))).toHaveLength(1);
  });
});

describe("NewTimeOffer when the times cannot be read", () => {
  it("says so with Try again, rather than claiming there are no free times", async () => {
    api.mockRejectedValue(new ApiError(0, "down"));
    render(<NewTimeOffer appointment={APPOINTMENT} onMoved={vi.fn()} onMore={vi.fn()} />);
    expect(await screen.findByText(/free times could not be read/)).toBeInTheDocument();
    expect(screen.queryByText(/No free times this week/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
