import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes } from "react-router-dom";

import { ApiError, type Me } from "../api/client";
import { SessionContext } from "../auth/session";
import { clock } from "../patient/data";
import { staffRoutes } from "./routes";

const api = vi.hoisted(() => vi.fn());
vi.mock("../api/client", async (original) => ({
  ...(await original<typeof import("../api/client")>()),
  api,
  // The screens read whole lists through apiAll, which calls api from inside its module; route it to the stub.
  apiAll: (path: string) => api(path),
}));

const HOUR = 3600 * 1000;
const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");

const DESK = {
  personId: "p-desk",
  givenName: "Nadine",
  familyName: "Fotso",
  tenantId: "t-1",
  roles: ["RECEPTIONIST"],
  patientProfileId: null,
  staffId: "s-desk",
  clinicId: "c-akwa",
} as unknown as Me;

const VISIT = {
  appointmentId: "a-1",
  reference: "APT-4194",
  clinicId: "c-akwa",
  patientProfileId: "pp-ama",
  appointmentTypeId: "at-follow",
  clinicianProfileId: "s-mbarga",
  startAt: at(72),
  endAt: at(72.5),
  state: "BOOKED",
  channel: "WALK_IN",
  bookedByRole: "RECEPTIONIST",
  createdAt: at(-24),
  version: 1,
};

function respond(visit: Record<string, unknown> | Error = VISIT) {
  api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
    if (path === "/clinicians") {
      return { clinicians: [{ clinicianProfileId: "s-mbarga", clinicId: "c-akwa", givenName: "Esther", familyName: "Mbarga", specialty: "Paediatrics" }] };
    }
    if (path === "/clinics") return { clinics: [{ clinicId: "c-akwa", name: "Medical Outpatient Unit" }] };
    if (path === "/appointment-types") return { appointmentTypes: [{ appointmentTypeId: "at-follow", name: "Follow-up consultation", cancellationWindowMinutes: 1440 }] };
    if (path.startsWith("/clinics/c-akwa/day")) return { appointments: [VISIT], patients: { "pp-ama": { givenName: "Ama", familyName: "Darko" } } };
    if (path === "/appointments/a-1" && init?.method === "DELETE") return { ...VISIT, state: "CLINIC_CANCELLED", outcome: "CLINIC_CANCELLED" };
    if (path === "/appointments/a-1") {
      if (visit instanceof Error) throw visit;
      return visit;
    }
    throw new Error(`unexpected ${path}`);
  });
}

function renderVisit(path = "/console/visits/a-1") {
  const session = { state: { status: "signed-in", me: DESK, audience: "staff" }, refresh: vi.fn(), signOut: vi.fn() };
  return render(
    <SessionContext.Provider value={session as never}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{staffRoutes}</Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  );
}

describe("One visit, from the desk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fr_vis_02: names the patient from the day the visit sits on", async () => {
    respond();
    renderVisit();
    // Two fetches in turn (the visit, then its day), so this waits longer than the default.
    expect(await screen.findByRole("heading", { name: "Ama Darko", level: 1 }, { timeout: 5000 })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(`/clinics/c-akwa/day?date=${clock.isoDate(VISIT.startAt)}`);
    const hero = screen.getByRole("region", { name: "Visit" });
    expect(hero).toHaveTextContent("Follow-up consultation · 30 minutes · booked by a receptionist");
    expect(hero).toHaveTextContent(clock.time(VISIT.startAt));
  });

  it("states what the record holds, and no more", async () => {
    respond();
    renderVisit();
    const facts = await screen.findByRole("region", { name: "Appointment" });
    expect(facts).toHaveTextContent("APT-4194");
    expect(facts).toHaveTextContent("Medical Outpatient Unit");
    expect(facts).toHaveTextContent("At the desk");
    expect(facts).toHaveTextContent("Dr Esther Mbarga");
    expect(facts).not.toHaveTextContent(/fee|room|notes/i);
  });

  it("fr_vis_03: cancels from the page, and the page shows it", async () => {
    respond();
    renderVisit();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel visit" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel this visit?" });
    await user.click(within(dialog).getByRole("radio", { name: "Unit closure" }));
    respond({ ...VISIT, state: "CLINIC_CANCELLED" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel visit" }));
    expect(await screen.findByText(/APT-4194 cancelled/)).toBeInTheDocument();
    expect(await screen.findByText("CANCELLED BY THE INSTITUTION")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel visit" })).not.toBeInTheDocument();
  });

  it("says plainly when the visit is not the caller's to see", async () => {
    respond(new ApiError(403, "not permitted"));
    renderVisit();
    expect(await screen.findByText("This visit is not on a list you can see.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the day" })).toBeInTheDocument();
  });
});

describe("What the desk can do to a visit (wave 2)", () => {
  // Mid-morning, so "half an hour from now" is still today however late the suite runs.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  function respondWith(visit: Record<string, unknown>) {
    respond(visit);
    const base = api.getMockImplementation() as (path: string, init?: { method?: string; json?: unknown }) => Promise<unknown>;
    api.mockImplementation(async (path: string, init?: { method?: string; json?: unknown }) => {
      const action = path.match(/^\/appointments\/a-1\/(\w[\w-]*)$/);
      if (action && init?.method === "POST") return { ...visit, state: action[1] === "arrive" ? "ARRIVED" : "NO_SHOW" };
      return base(path, init);
    });
  }

  it("fr_stf_04: records arrival on the visit's own day", async () => {
    respondWith({ ...VISIT, startAt: at(0.5), endAt: at(1) });
    renderVisit();
    await userEvent.click(await screen.findByRole("button", { name: "Record arrival" }));
    expect(api).toHaveBeenCalledWith("/appointments/a-1/arrive", { method: "POST" });
    expect(await screen.findByText(/Arrival recorded/)).toBeInTheDocument();
  });

  it("offers no arrival for a visit on another day", async () => {
    respondWith(VISIT);
    renderVisit();
    await screen.findByRole("button", { name: "Move visit" });
    expect(screen.queryByRole("button", { name: "Record arrival" })).not.toBeInTheDocument();
  });

  it("fr_stf_05: asks, rather than assumes, once the grace has passed", async () => {
    respondWith({ ...VISIT, startAt: at(-2), endAt: at(-1.5) });
    renderVisit();
    expect(await screen.findByText(/Did Ama Darko come\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark no-show" }));
    expect(api).toHaveBeenCalledWith("/appointments/a-1/no-show", { method: "POST" });
  });

  it("the desk does not open a consultation", async () => {
    respondWith({ ...VISIT, state: "ARRIVED", startAt: at(0.5), endAt: at(1) });
    renderVisit();
    await screen.findAllByText(/APT-4194/);
    expect(screen.queryByRole("button", { name: "Start consultation" })).not.toBeInTheDocument();
  });
});
